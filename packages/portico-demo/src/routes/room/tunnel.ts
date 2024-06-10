import { notifications } from "@mantine/notifications";
import {
  Endpoint,
  type EndpointOptions,
  type ICEDiscoveryOptions,
  Tunnel,
  type TunnelOptions,
} from "portico";

import type { Channel, Session } from "../../api";
import { useEffect, useMemo, useState } from "react";

export function useEndpoint(options?: EndpointOptions): Endpoint | undefined {
  return useMemo(() => new Endpoint(options), [options]);
}

export function useEndpointDiscovery<T = RTCIceServer[]>(
  source: string,
  options?: ICEDiscoveryOptions<T>
): Endpoint | undefined {
  const [endpoint, setEndpoint] = useState<Endpoint>();

  useEffect(() => {
    Endpoint.fromICEDiscovery(source, options)
      .then(setEndpoint)
      .catch((err) => {
        console.error(err);

        notifications.show({
          message:
            "Error setting up streaming; please reload or try again later.",
          color: "yellow",
          autoClose: 4000,
        });
      });
  }, [source, options]);

  return endpoint;
}

export function useTunnel(
  endpoint: Endpoint | undefined,
  session: Session | undefined,
  channel: Channel | undefined,
  local: MediaStream | undefined,
  options?: TunnelOptions
): Tunnel | undefined {
  const tunnel: Tunnel | undefined = useMemo(() => {
    if (endpoint == null || session == null || channel == null || local == null)
      return;

    const tunnel = new Tunnel(endpoint, { stream: local, ...options });

    channel.onsignal = (signal) => tunnel.deliverSignal(signal);
    tunnel.onsignal = ({ signal }) => channel.send(signal);

    console.log("created Tunnel");

    return tunnel;
  }, [endpoint, session, channel, local, options]);

  useEffect(() => {
    if (tunnel == null || session == null) return;

    if (session.role === "host") {
      tunnel.negotiate();
    }
  }, [tunnel, session]);

  return tunnel;
}

export function useLocalStream(
  channel: Channel | undefined,
  constraints?: MediaStreamConstraints
): MediaStream | undefined {
  const [stream, setStream] = useState<MediaStream>();

  if (constraints == null) constraints = defaultConstraints;

  useEffect(() => {
    if (channel == null) return;

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(setStream)
      .catch((err) => {
        console.error(err);

        notifications.show({
          message: "Could not start your camera and/or microphone.",
          color: "yellow",
          autoClose: 4000,
        });
      });
  }, [channel, constraints]);

  return stream;
}

const defaultConstraints: MediaStreamConstraints = { audio: true, video: true };
