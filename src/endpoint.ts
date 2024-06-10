export class Endpoint implements EndpointOptions {
  certificates?: RTCCertificate[];
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;

  constructor(options?: EndpointOptions) {
    Object.assign(this, options);
  }

  get configuration(): RTCConfiguration {
    return {
      ...(this.certificates != null
        ? { certificates: this.certificates }
        : null),
      ...(this.iceServers != null ? { iceServers: this.iceServers } : null),
      ...(this.iceTransportPolicy != null
        ? { iceTransportPolicy: this.iceTransportPolicy }
        : null),
    };
  }

  /**
   * Returns an {@link Endpoint} which uses public STUN servers.
   *
   * No TURN servers are included; peers who cannot connect directly to one
   * another will be unable to use WebRTC.
   */
  static publicSTUN(options?: Omit<EndpointOptions, "iceServers">): Endpoint {
    return new Endpoint({
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        { urls: ["stun:global.stun.twilio.com:3478"] },
      ],
      ...options,
    });
  }

  /**
   * Populate an `Endpoint` from an API which provides ICE servers.
   *
   * @example Creating an Endpoint which uses [metered.ca][]
   *
   * ```ts
   * const endpoint = await Endpoint.fromICEDiscovery(
   *   "https://<user>.metered.live/api/v1/turn/credentials?apiKey=<key>"
   * );
   * ```
   *
   * [metered.ca]: https://www.metered.ca/stun-turn
   */
  static async fromICEDiscovery<T = RTCIceServer[]>(
    source: string | Request,
    options?: ICEDiscoveryOptions<T>
  ): Promise<Endpoint> {
    const request =
      typeof source === "string"
        ? new Request(source, {
            headers: { Accept: "application/json" },
          })
        : source;

    const parse =
      options?.parse ?? ((data: T): RTCIceServer[] => data as RTCIceServer[]);
    // biome-ignore lint/performance/noDelete: removing non-Endpoint option
    if (options?.parse) delete options.parse;

    const response = await fetch(request);
    const data: T = await response.json();
    const iceServers = parse(data);

    return new Endpoint({ iceServers, ...options });
  }
}

export interface EndpointOptions
  extends Pick<
    RTCConfiguration,
    "certificates" | "iceServers" | "iceTransportPolicy"
  > {}

export interface ICEDiscoveryOptions<T>
  extends Omit<EndpointOptions, "iceServers"> {
  parse?: (response: T) => RTCIceServer[];
}
