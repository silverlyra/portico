import { notifications } from "@mantine/notifications";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

import { type Channel, ResponseError, type Session } from "../../api";
import { useClient } from "../../components/client";

export function useSession(
  slug: string
): [Session | undefined, Channel | undefined] {
  const client = useClient();
  const [session, setSession] = useState<Session>();
  const [channel, setChannel] = useState<Channel>();
  const [_, navigate] = useLocation();

  const created = useRef(false);

  useEffect(() => {
    if (!created.current) {
      created.current = true;
      return;
    }

    client
      .createSession({ slug })
      .then((session) => {
        const channel = client.joinSession(session);
        setSession(session);
        setChannel(channel);
      })
      .catch((err) => {
        if (err instanceof ResponseError) {
          if (err.status === 401) {
            const params = new URLSearchParams({ join: slug });
            notifications.show({
              message: "Please enter your name before joining.",
              autoClose: 2500,
            });
            navigate(`/?${params}`, { replace: true });
            return;
          }
          if (err.status === 404) {
            notifications.show({
              message: "Room not found.",
              autoClose: 4000,
            });
            navigate("/");
            return;
          }
          if (err.status === 409) {
            notifications.show({
              message: err.description,
              color: "yellow",
              autoClose: 4000,
            });
            return;
          }
        }

        console.error(err);
        notifications.show({
          message: "Error joining session.",
          color: "yellow",
          autoClose: 4000,
        });
      });
  }, [slug, client.createSession, client.joinSession, navigate]);

  useEffect(() => {
    const current = channel;
    if (current) return () => current.close();
  }, [channel]);

  return [session, channel];
}
