import { Button, Stack, TextInput } from "@mantine/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { useLocation, useSearch } from "wouter";

import { useClient, useSetUser, useUser } from "../../components/client";
import "./home.css";

export default function Home() {
  const client = useClient();
  const user = useUser();
  const setUser = useSetUser();

  const [_location, navigate] = useLocation();
  const query = useQuery();
  const join = useMemo(() => query.get("join"), [query]);

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | false>(false);
  const [running, setRunning] = useState(false);

  const onChange = useCallback(
    (event: NameEvent) => {
      const { value } = event.currentTarget;
      setName(value);
      if (nameError && value) setNameError(false);
    },
    [nameError]
  );

  const submit = useCallback(
    async (e: SubmitEvent) => {
      e.preventDefault();

      if (!name) {
        setNameError("Please enter your name");
        return;
      }

      setRunning(true);

      try {
        if (user == null) {
          setUser(await client.register({ name }));
        } else if (user.name !== name) {
          setUser(await client.updateUser({ name }));
        }

        const slug = join || (await client.createRoom()).slug;
        navigate(`/room/${slug}`);
      } finally {
        setRunning(false);
      }
    },
    [client, user, name, join, setUser, navigate]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: only run when user resolved
  useEffect(() => {
    if (user != null && name === "") {
      setName(user.name);
    }
  }, [user]);

  return (
    <div className="home-wrapper" role="presentation">
      <main className="home">
        <h1>Portico Demo</h1>
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput
              label="Your name"
              value={name}
              onChange={onChange}
              error={nameError}
            />
            <Button
              type="submit"
              variant="filled"
              color="teal"
              loading={running}
              rightSection={<IconArrowRight size={14} />}
            >
              {join ? "Join" : "Create"} room
            </Button>
          </Stack>
        </form>
      </main>
    </div>
  );
}

type NameEvent = ChangeEvent<HTMLInputElement>;
type SubmitEvent = FormEvent<HTMLFormElement>;

function useQuery(): URLSearchParams {
  const search = useSearch();

  return useMemo(() => new URLSearchParams(search || undefined), [search]);
}
