import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { Client, User } from "../api";

export interface ClientContextData {
  client: Client;
  user: User | null | undefined;
  setUser(user: User | null): void;
}

export const ClientContext = createContext<ClientContextData>({
  client: null!,
  user: undefined,
  setUser() {},
});

export function ClientProvider({
  client,
  children,
}: {
  client: Client;
  children: ReactNode;
}) {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    client.getUser().then(setUser);
  }, [client]);

  return (
    <ClientContext.Provider value={{ client, user, setUser }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): Client {
  const { client } = useContext(ClientContext);
  return client;
}

export function useUser(): User | null | undefined {
  const { user } = useContext(ClientContext);
  return user;
}

export function useSetUser(): ClientContextData["setUser"] {
  const { setUser } = useContext(ClientContext);
  return setUser;
}
