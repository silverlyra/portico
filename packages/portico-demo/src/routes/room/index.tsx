import { ActionIcon, Indicator } from "@mantine/core";
import {
  IconMessages,
  IconMicrophone,
  IconPhoneOff,
  IconSettings,
  IconVideo,
} from "@tabler/icons-react";
import type { Tunnel } from "portico";

import type { Channel } from "../../api";
import { useMessages } from "./messages";
import { useSession } from "./session";
import "./room.css";
import { useEndpointDiscovery, useLocalStream, useTunnel } from "./tunnel";
import { useEffect, useRef, useState } from "react";

const DISCOVERY =
  "https://taskroulette.metered.live/api/v1/turn/credentials?apiKey=c3c0374cd434ee6a930bb194265abc89d568";

export interface Props {
  slug: string;
}

export default function Room({ slug }: Props) {
  const [session, channel] = useSession(slug);
  const { unread } = useMessages(channel);

  const local = useLocalStream(channel);
  const endpoint = useEndpointDiscovery(DISCOVERY);
  const tunnel = useTunnel(endpoint, session, channel, local);

  return (
    <div className="room" role="presentation">
      <header>
        <h1>{session?.room.slug ?? slug}</h1>
      </header>
      <Viewers tunnel={tunnel} local={local} />
      <Controls channel={channel} unread={unread} />
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
  unread,
}: {
  channel: Channel | undefined;
  unread: number;
}) {
  return (
    <footer role="navigation">
      <ActionIcon
        variant="light"
        color="green"
        size="xl"
        radius="xl"
        aria-label="Enable video"
      >
        <IconVideo style={{ width: "70%", height: "70%" }} />
      </ActionIcon>
      <ActionIcon
        variant="light"
        color="green"
        size="xl"
        radius="xl"
        aria-label="Enable voice"
      >
        <IconMicrophone style={{ width: "70%", height: "70%" }} />
      </ActionIcon>
      <ActionIcon
        variant="filled"
        color="red"
        size="xl"
        radius="xl"
        aria-label="End call"
      >
        <IconPhoneOff style={{ width: "70%", height: "70%" }} />
      </ActionIcon>
      <Indicator color="green" disabled={!unread}>
        <ActionIcon
          variant="light"
          color="teal"
          size="xl"
          radius="xl"
          aria-label="Chat"
        >
          <IconMessages style={{ width: "70%", height: "70%" }} />
        </ActionIcon>
      </Indicator>
      <ActionIcon
        variant="light"
        color="gray"
        size="xl"
        radius="xl"
        aria-label="Settings"
      >
        <IconSettings style={{ width: "70%", height: "70%" }} stroke={1.5} />
      </ActionIcon>
    </footer>
  );
}
