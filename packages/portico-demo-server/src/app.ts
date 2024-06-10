import cookieParser from "cookie-parser";
import express, {
  json,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import websocket from "express-ws";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { WebSocket } from "ws";

import type { Config } from "./config";
import {
  Forbidden,
  NotFound,
  ResponseError,
  type Room,
  Unauthorized,
  type Store,
  type User,
} from "./data";
import type { Request as Input } from "./message";

export interface Dependencies {
  config: Config;
  store: Store;
}

export default function app({ config, store }: Dependencies) {
  const { app } = websocket(express());

  app.use(cookieParser());
  app.use(json({ limit: 1024 }));

  // Verify auth JWT
  app.use(async (req, res, next) => {
    const token = req.cookies?.auth;

    if (token != null) {
      const { secret, publicKey, verify: options } = config.auth.jwt;

      try {
        const payload = jwt.verify(
          token,
          publicKey ?? secret,
          options
        ) as JwtPayload;

        const user =
          typeof payload === "object" && payload.sub
            ? await store.getUser(payload.sub)
            : null;
        if (user == null) throw new Error("Failed to find user");

        // biome-ignore lint/suspicious/noExplicitAny: need this on Request
        (req as any).user = user;
      } catch (err) {
        console.log(new Date().toISOString(), `auth ${err}`);
        res.clearCookie("auth");
      }
    }

    next();
  });

  app.get(
    "/api/user",
    handler(async ({ user }) => {
      if (user == null) throw new Unauthorized();
      return { user };
    })
  );

  app.post(
    "/api/user",
    handler<{ name: string }, { user: User }>(async ({ res, body }) => {
      const user = await store.createUser(body);

      const { secret, ttl, sign: options } = config.auth.jwt;
      const token = jwt.sign({ sub: user.id }, secret, options);
      res.cookie("auth", token, {
        maxAge: ttl,
        sameSite: "strict",
        httpOnly: true,
      });

      console.log(new Date().toISOString(), "register", `user=${user.id}`);

      return { user };
    })
  );

  app.put(
    "/api/user",
    handler<{ name: string }, { user: User }>(
      async ({ res, body, user: current }) => {
        if (current == null) throw new Unauthorized();

        const user = await store.updateUser(current.id, body);
        return { user };
      }
    )
  );

  app.post(
    "/api/room",
    handler(async ({ user }) => {
      if (user == null) throw new Unauthorized();

      const room = await store.createRoom(user.id);

      console.log(
        new Date().toISOString(),
        "create",
        `user=${user.id}`,
        `room=${room.slug}`
      );

      return {
        room: {
          id: room.id,
          slug: room.slug,
          created: room.created,
          owner: { id: user.id, name: user.name },
        },
      };
    })
  );

  app.post(
    "/api/room/:slug/join",
    handler(async ({ req, user }) => {
      if (user == null) throw new Unauthorized();

      const { slug } = req.params;
      const room = await store.getRoom("slug", slug);
      if (room == null) throw new NotFound("Room not found.");

      const session = await store.createSession(room.id, user.id);

      console.log(
        new Date().toISOString(),
        "join",
        `user=${user.id}`,
        `room=${room.slug}`,
        `session=${session.id}`,
        `role=${session.role}`
      );

      return {
        session: {
          id: session.id,
          role: session.role,
          room: { id: room.id, slug: room.slug },
        },
      };
    })
  );

  app.ws("/api/session/:id", (ws: WebSocket, req, next) => {
    const user = actor(req);
    if (user == null) {
      next(new Unauthorized());
      return;
    }

    const { id } = req.params;

    // store any incoming messages received before setup()
    let queue: Input[] | undefined = [];
    let room: Room | null = null;

    async function setup() {
      const session = await store.getSession(id);
      if (session == null) throw new NotFound("Session not found.");

      if (session.owner !== user!.id)
        throw new Forbidden("Session belongs to a different user.");

      room = await store.getRoom("id", session.room);
      if (room == null) throw new NotFound("Room not found.");

      console.log(
        new Date().toISOString(),
        "connect",
        `user=${user!.id}`,
        `room=${room.slug}`,
        `session=${id}`
      );

      store.forwardEvents(room.id, user!.id, id, ws).catch((err) => {
        console.error(err);
        ws.close();
        next(err);
      });

      store.writeMessage(room.id, {
        type: "join",
        time: Date.now(),
        user: user!.id,
        session: id,
        role: user!.id === room.owner ? "host" : "guest",
      });

      if (queue != null) {
        const queued = queue;
        queue = undefined;
        for (const input of queued) {
          deliver(input);
        }
      }
    }

    function deliver(input: Input) {
      if (queue != null) {
        queue.push(input);
        return;
      }
      if (room == null) return;

      switch (input.type) {
        case "chat":
          store.writeMessage(room.id, {
            type: "chat",
            time: Date.now(),
            user: user!.id,
            session: id,
            message: input.message,
          });
          break;
        case "leave":
          ws.close();
          break;

        case "ice":
        case "sdp":
          store.writeSignal(id, input);
          break;
      }
    }

    ws.on("message", async (data: string) => {
      if (typeof data !== "string") return;

      try {
        const input: Input = JSON.parse(data);
        if (
          !input ||
          typeof input !== "object" ||
          typeof input.type !== "string"
        )
          throw new TypeError("Invalid session request");

        deliver(input);
      } catch (err) {
        ws.close();
        next(err);
      }
    });

    ws.on("close", async () => {
      console.log(
        new Date().toISOString(),
        "disconnect",
        `user=${user!.id}`,
        `room=${room?.slug}`,
        `session=${id}`
      );

      if (room != null) {
        await store.writeMessage(room.id, {
          type: "leave",
          time: Date.now(),
          user: user!.id,
          session: id,
        });
      }
      await store.deleteSession(id);
    });

    ws.on("error", next);

    setup().catch((err) => {
      ws.close();
      next(err);
    });
  });

  app.use((err, req, res, _next) => {
    console.log(
      new Date().toISOString(),
      `[error] ${req.method} ${req.path} ${err}`
    );

    if (typeof err === "object" && err && err instanceof ResponseError) {
      res.status(err.status).json({ error: err.name, message: err.message });
    } else {
      res
        .status(500)
        .type("text/plain; charset=utf-8")
        .send("Unexpected error");
    }
  });

  return app;
}

function handler<T, V>(impl: Handler<T, V>) {
  return (req: Request, res: Response, next: NextFunction) => {
    impl({ req, res, user: actor(req), body: req.body })
      .then((result) => {
        if (result && typeof result === "object") res.json(result);
      })
      .catch(next);
  };
}

type Handler<T, V> = (ctx: Context<T>) => Promise<V>;

interface Context<T> {
  req: Request;
  res: Response;
  user: User | null;
  body: T;
}

// biome-ignore lint/suspicious/noExplicitAny: need this on Request
const actor = (req: Request): User | null => (req as any).user ?? null;
