import { notifications } from "@mantine/notifications";
import type { Message } from "portico-demo-server";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Channel } from "../../api";

export function useMessages(channel: Channel | undefined) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const [latestRead, setLatestRead] = useState<number>();
  const latestChat = useMemo(
    () =>
      messages.reduce<number | undefined>((l, m) => {
        return m.type === "chat" && m.time > (l ?? 0) ? m.time : l;
      }, undefined),
    [messages]
  );
  const unread = useMemo(
    () =>
      messages.reduce<number>(
        (n, m) => (m.type === "chat" && m.time > (latestRead ?? 0) ? n + 1 : n),
        0
      ),
    [messages, latestRead]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages
  useEffect(() => {
    if (channel == null) return;

    channel.onopen = () => setConnected(true);
    channel.onclose = (event) => {
      setConnected(false);

      if (!event.wasClean) {
        notifications.show({
          message: "Lost connection to server.",
          color: "yellow",
          autoClose: 4000,
        });
      }
    };

    channel.onmessage = (message) => setMessages([...messages, message]);
  }, [channel]);

  const markRead = useCallback(() => setLatestRead(latestChat), [latestChat]);

  return {
    connected,
    messages,
    latestChat,
    unread,
    markRead,
  };
}
