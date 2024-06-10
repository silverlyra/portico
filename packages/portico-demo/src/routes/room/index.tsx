import { ActionIcon, Indicator } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconMessages,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconSettings,
  IconVideo,
  IconVideoOff,
} from "@tabler/icons-react";
import type { Tunnel } from "portico";
import { useLocation } from "wouter";

import type { Channel } from "../../api";
import { useStreamControls } from "./media";
import { useMessages } from "./messages";
import { useSession } from "./session";
import { useEndpointDiscovery, useLocalStream, useTunnel } from "./tunnel";
import "./room.css";

const DISCOVERY =
  "https://taskroulette.metered.live/api/v1/turn/credentials?apiKey=c3c0374cd434ee6a930bb194265abc89d568";

export interface Props {
  slug: string;
}

export default function Room({ slug }: Props) {
  const [session, channel] = useSession(slug);
  const { connected, unread } = useMessages(channel);

  const local = useLocalStream(channel);
  const endpoint = useEndpointDiscovery(DISCOVERY);
  const tunnel = useTunnel(endpoint, session, channel, local);

  return (
    <div className="room" role="presentation">
      <header>
        <h1>{session?.room.slug ?? slug}</h1>
      </header>
      <Viewers tunnel={tunnel} local={local} />
      <Controls
        channel={channel}
        local={local}
        connected={connected}
        unread={unread}
      />
    </div>
  );
}

function Viewers({
  tunnel,
  local,
}: {
  tunnel: Tunnel | undefined;
  local: MediaStream | undefined;
}) {
  const [remote, setRemote] = useState<MediaStream>();

  useEffect(() => {
    if (tunnel == null) return;

    tunnel.ontrack = ({ stream }) => setRemote(stream);
  }, [tunnel]);

  return (
    <main>
      <Viewer stream={local} local />
      <Viewer stream={remote} />
    </main>
  );
}

function Viewer({
  stream,
  local,
}: {
  stream: MediaStream | undefined;
  local?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (stream == null || ref.current == null) return;

    ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);

  return <video ref={ref} playsInline autoPlay muted={local} />;
}

function Controls({
  channel,
  local,
  connected,
  unread,
}: {
  channel: Channel | undefined;
  local: MediaStream | undefined;
  connected: boolean;
  unread: number;
}) {
  const [_location, navigate] = useLocation();
  const { audio, video } = useStreamControls(local);

  const endCall = useCallback(() => {
    if (connected && channel != null) {
      channel.send({ type: "leave" });
    } else {
      navigate("/");
    }
  }, [connected, channel, navigate]);

  const iconStyle = useMemo(() => ({ width: "70%", height: "70%" }), []);

  return (
    <footer role="navigation">
      <ActionIcon
        variant={video.available && !video.enabled ? "filled" : "light"}
        color={video.available ? (video.enabled ? "green" : "red") : "gray"}
        size="xl"
        radius="xl"
        aria-label="Toggle camera"
        disabled={!video.available}
        onClick={video.toggle}
      >
        {video.enabled ? (
          <IconVideo style={iconStyle} />
        ) : (
          <IconVideoOff style={iconStyle} />
        )}
      </ActionIcon>
      <ActionIcon
        variant={audio.available && !audio.enabled ? "filled" : "light"}
        color={audio.available ? (audio.enabled ? "green" : "red") : "gray"}
        size="xl"
        radius="xl"
        aria-label="Toggle microphone"
        disabled={!audio.available}
        onClick={audio.toggle}
      >
        {audio.enabled ? (
          <IconMicrophone style={iconStyle} />
        ) : (
          <IconMicrophoneOff style={iconStyle} />
        )}
      </ActionIcon>
      <ActionIcon
        variant="filled"
        color="red"
        size="xl"
        radius="xl"
        aria-label="End call"
        onClick={endCall}
      >
        <IconPhoneOff style={iconStyle} />
      </ActionIcon>
      <Indicator color="green" disabled={!unread}>
        <ActionIcon
          variant="light"
          color="teal"
          size="xl"
          radius="xl"
          aria-label="Chat"
        >
          <IconMessages style={iconStyle} />
        </ActionIcon>
      </Indicator>
      <ActionIcon
        variant="light"
        color="gray"
        size="xl"
        radius="xl"
        aria-label="Settings"
      >
        <IconSettings style={iconStyle} stroke={1.5} />
      </ActionIcon>
    </footer>
  );
}
