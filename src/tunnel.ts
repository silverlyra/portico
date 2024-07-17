import type { Endpoint, EndpointOptions } from "./endpoint";
import type { CandidateMedia, ICE, Signal } from "./signal";

export interface TunnelOptions
  extends Omit<RTCConfiguration, keyof EndpointOptions> {
  /** Whether this peer will make the initial SDP offer. */
  initiate?: boolean;

  /** A {@link MediaStream} to immediately add. */
  stream?: MediaStream;
}

export class Tunnel extends EventTarget {
  public readonly endpoint: Endpoint;
  private impl: RTCPeerConnection;

  private initiate: boolean;

  private candidates: LocalCandidates;

  constructor(endpoint: Endpoint, options?: TunnelOptions) {
    super();

    const { initiate, stream, ...config } = options ?? {};

    this.endpoint = endpoint;
    this.impl = new RTCPeerConnection({
      ...endpoint.configuration,
      ...config,
    });

    this.initiate = initiate ?? false;
    this.candidates = new LocalCandidates(this);

    this.setupConnection();

    if (stream != null) {
      this.addStream(stream);
    }
  }

  private setupConnection() {
    this.impl.ondatachannel = (event) => {
      this.dispatchEvent(DataChannelEvent.fromRTC(event));
    };

    this.impl.onicecandidate = ({ candidate }) => {
      this.candidates.add(candidate);
    };

    this.impl.ontrack = (event) => {
      this.dispatchEvent(TrackEvent.fromRTC(event));
    };
  }

  get connection(): RTCPeerConnection {
    return this.impl;
  }

  open(label: string, options?: DataChannelOptions): RTCDataChannel {
    const { binaryType, ...config } = options ?? {};

    const channel = this.impl.createDataChannel(label, config);
    if (binaryType) channel.binaryType = binaryType;

    return channel;
  }

  addStream(stream: MediaStream): TunneledStream {
    const senders = stream
      .getTracks()
      .map((track) => this.impl.addTrack(track, stream));
    return new TunneledStream(this, senders);
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): TunneledTrack {
    return new TunneledTrack(this, this.impl.addTrack(track, stream));
  }

  removeStream(stream: TunneledStream) {
    for (const sender of stream.senders) {
      this.impl.removeTrack(sender);
    }
  }

  removeTrack(track: TunneledTrack) {
    this.impl.removeTrack(track.sender);
  }

  async negotiate(mode: "offer" | "answer" = "offer") {
    const description = await (mode === "offer"
      ? this.impl.createOffer()
      : this.impl.createAnswer());

    const { type, sdp } = description;
    if (!sdp) return;

    await this.impl.setLocalDescription(description);

    this.dispatchEvent(
      new SignalEvent({
        type: "sdp",
        description: { type, contents: sdp },
      })
    );
  }

  /** Process a {@link Signal} from the remote peer. */
  async deliverSignal(signal: Signal) {
    switch (signal.type) {
      case "ice":
        for (const [candidate, media] of signal.candidates) {
          const [sdpMid, sdpMLineIndex] =
            media != null ? media : [undefined, undefined];

          await this.impl.addIceCandidate({
            candidate,
            sdpMid,
            sdpMLineIndex,
          });
        }

        if (signal.done) {
          await this.impl.addIceCandidate();
        }
        break;

      case "sdp": {
        const { contents: sdp, ...meta } = signal.description;
        await this.impl.setRemoteDescription({ ...meta, sdp });

        if (meta.type === "offer") {
          await this.negotiate("answer");
        }
      }
    }
  }

  get configuration(): RTCConfiguration {
    return this.impl.getConfiguration();
  }

  set configuration(config: RTCConfiguration) {
    this.impl.setConfiguration(config);
  }

  private readonly handlers: Partial<TunnelHandlers> = {};

  get onsignal(): EventHandler<Tunnel, SignalEvent> | undefined {
    return this.handlers.signal;
  }

  set onsignal(handler: EventHandler<Tunnel, SignalEvent> | null | undefined) {
    this.setHandler("signal", handler);
  }

  get ontrack(): EventHandler<Tunnel, TrackEvent> | undefined {
    return this.handlers.track;
  }

  set ontrack(handler: EventHandler<Tunnel, TrackEvent> | null | undefined) {
    this.setHandler("track", handler);
  }

  private setHandler<const E extends keyof TunnelHandlers>(
    event: E,
    handler: TunnelHandlers[E] | null | undefined
  ) {
    if (this.handlers[event]) {
      this.removeEventListener(event, this.handlers[event] as EventListener);
    }
    if (handler) {
      handler = handler.bind(this) as TunnelHandlers[E];
      this.addEventListener(event, handler as EventListener);
    }

    this.handlers[event] = handler ?? undefined;
  }
}

export interface DataChannelOptions extends RTCDataChannelInit {
  /** Sets how binary data will be represented in `message` events. */
  binaryType: RTCDataChannel["binaryType"];
}

interface TunnelHandlers {
  signal: EventHandler<Tunnel, SignalEvent>;
  track: EventHandler<Tunnel, TrackEvent>;
}

export type EventHandler<T extends object, E extends Event> = (
  this: T,
  event: E
) => void;

export class DataChannelEvent extends CustomEvent<{
  readonly channel: RTCDataChannel;
}> {
  static fromRTC({ channel }: RTCDataChannelEvent): DataChannelEvent {
    return new DataChannelEvent(channel);
  }

  constructor(channel: RTCDataChannel) {
    super("datachannel", { detail: { channel } });
  }

  get channel(): RTCDataChannel {
    return this.detail.channel;
  }

  get label(): string {
    return this.channel.label;
  }

  get protocol(): string {
    return this.channel.protocol;
  }
}

export class SignalEvent extends CustomEvent<{ readonly signal: Signal }> {
  constructor(signal: Signal) {
    super("signal", { detail: { signal } });
  }

  get signal(): Signal {
    return this.detail.signal;
  }
}

export class TrackEvent extends CustomEvent<{
  readonly streams: ReadonlyArray<MediaStream>;
  readonly track: MediaStreamTrack;
}> {
  static fromRTC({ streams, track }: RTCTrackEvent): TrackEvent {
    return new TrackEvent(track, streams);
  }

  constructor(track: MediaStreamTrack, streams: ReadonlyArray<MediaStream>) {
    super("track", { detail: { streams, track } });
  }

  get track(): MediaStreamTrack {
    return this.detail.track;
  }

  get stream(): MediaStream {
    return this.streams[0]!;
  }

  get streams(): ReadonlyArray<MediaStream> {
    return this.detail.streams;
  }
}

export class TunneledStream {
  public readonly senders: readonly RTCRtpSender[];
  private readonly tunnel: WeakRef<Tunnel>;

  constructor(tunnel: Tunnel, senders: readonly RTCRtpSender[]) {
    this.senders = senders;
    this.tunnel = new WeakRef(tunnel);
  }

  remove() {
    this.tunnel.deref()?.removeStream(this);
  }
}

export class TunneledTrack {
  public readonly sender: RTCRtpSender;
  private readonly tunnel: WeakRef<Tunnel>;

  constructor(tunnel: Tunnel, sender: RTCRtpSender) {
    this.sender = sender;
    this.tunnel = new WeakRef(tunnel);
  }

  remove() {
    this.tunnel.deref()?.removeTrack(this);
  }
}

class LocalCandidates {
  private readonly gathered: RTCIceCandidate[] = [];
  private sent = 0;
  private done = false;

  private emitter: EventTarget | undefined;
  private readonly debounce = 150;
  private timer: Timer | undefined;

  constructor(emitter: EventTarget) {
    this.emitter = emitter;
  }

  add(candidate: RTCIceCandidate | null) {
    if (candidate != null) {
      this.gathered.push(candidate);
    } else {
      this.done = true;
    }

    this.deliverLazily();
  }

  get(): ICE | null {
    if (this.sent >= this.gathered.length && !this.done) return null;

    const fresh = this.gathered.slice(this.sent);
    this.sent += fresh.length;

    return {
      type: "ice",
      candidates: fresh.map((c) => {
        const media: CandidateMedia | null =
          c.sdpMid != null || c.sdpMLineIndex != null
            ? [c.sdpMid, c.sdpMLineIndex]
            : null;
        return [c.candidate, media];
      }),
      done: this.done,
    };
  }

  private deliverLazily() {
    if (this.timer == null && this.emitter != null) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.deliver();
      }, this.debounce);
    }
  }

  private deliver() {
    if (this.emitter == null) return;

    const signal = this.get();
    if (signal == null) return;

    this.emitter.dispatchEvent(new SignalEvent(signal));
  }

  dispose() {
    this.emitter = undefined;

    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

type Timer = ReturnType<typeof setTimeout>;
