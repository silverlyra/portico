import "@mantine/core/styles.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { Route, Router, Switch } from "wouter";

import Home from "./routes/home";
import Room from "./routes/room";
import { theme } from "./theme";
import { useMemo } from "react";
import { Client } from "./api";
import { ClientProvider } from "./components/client";

export default function App() {
  const client = useMemo(() => new Client(), []);

  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ClientProvider client={client}>
        <Routes />
      </ClientProvider>
    </MantineProvider>
  );
}

export function Routes() {
  return (
    <Router>
      <Switch>
        <Route path="/">
          <Home />
        </Route>
        <Route path="/room/:slug">{({ slug }) => <Room slug={slug} />}</Route>
      </Switch>
      <Notifications position="top-right" zIndex={1000} limit={2} />
    </Router>
  );
}
