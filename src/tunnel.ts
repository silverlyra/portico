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
    this.impl.onicecandidate = ({ candidate }) => {
      this.candidates.add(candidate);
    };

    this.impl.ontrack = (event) => {
      this.dispatchEvent(TrackEvent.fromRTC(event));
    };
  }

  addStream(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      this.addTrack(track, stream);
    }
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream) {
    this.impl.addTrack(track, stream);
  }

  // TODO: removeStream and removeTrack

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
          await this.impl.addIceCandidate(null as unknown as undefined);
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
    if (this.handlers.signal) {
      this.removeEventListener("signal", this.handlers.signal as EventListener);
    }
    if (handler) {
      handler = handler.bind(this);
      this.addEventListener("signal", handler as EventListener);
    }

    this.handlers.signal = handler ?? undefined;
  }

  get ontrack(): EventHandler<Tunnel, TrackEvent> | undefined {
    return this.handlers.track;
  }

  set ontrack(handler: EventHandler<Tunnel, TrackEvent> | null | undefined) {
    if (this.handlers.track) {
      this.removeEventListener("track", this.handlers.track as EventListener);
    }
    if (handler) {
      handler = handler.bind(this);
      this.addEventListener("track", handler as EventListener);
    }

    this.handlers.track = handler ?? undefined;
  }
}

interface TunnelHandlers {
  signal: EventHandler<Tunnel, SignalEvent>;
  track: EventHandler<Tunnel, TrackEvent>;
}

export type EventHandler<T extends object, E extends Event> = (
  this: T,
  event: E
) => void;

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
