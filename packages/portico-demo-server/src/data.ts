import { createPool, type Pool } from "generic-pool";
import { Redis, type RedisValue } from "ioredis";
import { generateSlug } from "random-word-slugs";
import type { Signal } from "portico";
import { generator } from "ui7";
import type { WebSocket } from "ws";

import type { Config, RetentionConfig } from "./config";
import type { Event, Message, StoredMessage } from "./message";

export const uuid = generator();

export class Store {
  private readonly pool: Pool<Redis>;
  private readonly retain: RetentionConfig;

  constructor(pool: Pool<Redis>, retain: RetentionConfig) {
    this.pool = pool;
    this.retain = retain;
  }

  static fromConfig(config: Config): Store {
    const { url, pool: poolOptions, ...options } = config.redis;

    const pool = createPool<Redis>(
      {
        async create() {
          return new Redis(url, options);
        },
        async destroy(client: Redis): Promise<void> {
          await client.quit();
        },
      },
      poolOptions
    );

    return new Store(pool, config.retention);
  }

  createUser({ name }: { name: string }): Promise<User> {
    return this.run(async (store) => {
      const user = await store.createUser(name);
      await store.addUserEvent(user.id, { type: "register" });
      return user;
    });
  }

  getUser(id: string): Promise<User | null> {
    return this.run((store) => store.getUser(id));
  }

  updateUser(id: string, data: Pick<User, "name">): Promise<User> {
    return this.run(async (store) => {
      await store.updateUser(id, data);

      const user = await store.getUser(id);
      if (user == null) throw new Conflict("User no longer exists.");

      return user;
    });
  }

  createRoom(owner: string): Promise<Room> {
    return this.run((store) => store.createRoom(owner));
  }

  getRoom(by: "id" | "slug", key: string): Promise<Room | null> {
    return this.run((store) => store.getRoom(by, key));
  }

  writeMessage(connection: string, message: StoredMessage): Promise<string> {
    return this.run((store) => store.writeMessage(connection, message));
  }

  createSession(room: string, actor: string): Promise<Session> {
    return this.run((store) => store.createSession(room, actor));
  }

  getSession(id: string): Promise<{ room: string; owner: string } | null> {
    return this.run((store) => store.getSession(id));
  }

  deleteSession(id: string): Promise<void> {
    return this.run((store) => store.deleteSession(id));
  }

  writeSignal(connection: string, signal: Signal): Promise<string> {
    return this.run((store) => store.writeSignal(connection, signal));
  }

  async forwardEvents(
    room: string,
    actor: string,
    connection: string,
    dest: WebSocket
  ) {
    const redis = await this.pool.acquire();
    const users: Map<string, User | null> = new Map();

    let messageCursor = "0";
    let peer: string | undefined;
    let peerCursor = "0";

    const getUser = async (id: string): Promise<User | null> => {
      let user = users.get(id);
      if (user === undefined) {
        user = await new ConnectedStore(redis, this.retain).getUser(id);
        users.set(id, user);
      }

      return user;
    };

    const send = (message: Event) => {
      console.log(connection, "<--", message.type);
      dest.send(JSON.stringify(message));
    };

    try {
      const conns = await redis.hgetall(key("room", room, "connections"));
      if (!conns || conns[actor] !== connection) {
        dest.close();
        return;
      }

      for (const [userId, pc] of Object.entries(conns)) {
        if (userId !== actor) {
          peer = pc;
          break;
        }
      }

      while (dest.readyState === dest.OPEN) {
        const req = peer
          ? [
              key("room", room, "messages"),
              key("connection", peer, "signal"),
              messageCursor,
              peerCursor,
            ]
          : [key("room", room, "messages"), messageCursor];

        const result = await redis.xread("BLOCK", 1000, "STREAMS", ...req);
        if (result == null) continue;

        for (const [k, entries] of result) {
          for (const [id, fields] of entries) {
            if (k.startsWith("room:")) messageCursor = id;
            else if (k.startsWith("connection:")) peerCursor = id;

            let data: StoredMessage | Signal | undefined;

            for (let i = 0; i < fields.length - 1; i += 2) {
              if (fields[i] === "data") {
                data = JSON.parse(fields[i + 1]!);
                break;
              }
            }

            if (data == null) continue;

            switch (data.type) {
              case "join":
              case "leave":
              case "chat": {
                const user = await getUser(data.user);
                if (user != null) {
                  send({ ...data, user });
                }

                if (data.type === "join" && data.user !== actor) {
                  peer = data.session;
                } else if (data.type === "leave" && data.session === peer) {
                  peer = undefined;
                }
                break;
              }

              case "ice":
              case "sdp":
                send(data);
            }
          }
        }
      }
    } finally {
      await this.pool.release(redis);
    }
  }

  private run<T>(fn: (store: ConnectedStore) => Promise<T>): Promise<T> {
    return this.pool.use((redis) => fn(new ConnectedStore(redis, this.retain)));
  }
}

class ConnectedStore {
  constructor(
    private readonly redis: Redis,
    private readonly retain: RetentionConfig
  ) {}

  async createUser(name: string): Promise<User> {
    const id = uuid();
    const created = new Date();

    await this.redis.hmset(key("user", id), {
      id,
      name,
      created: +created,
    });

    await this.redis.pexpire(key("user", id), this.retain.users);

    return { id, name, created };
  }

  async getUser(id: string): Promise<User | null> {
    const data = await this.redis.hgetall(key("user", id));

    if (!data || Object.keys(data).length === 0) return null;

    return {
      id: data.id!,
      name: data.name!,
      created: date(data.created!),
    };
  }

  async addUserEvent(user: string, event: UserEvent) {
    if (!(await this.redis.exists(key("user", user)))) return;

    const pairs = Object.entries<RedisValue>(event).flat(1);

    await this.redis
      .pipeline()
      .xadd(key("user", user, "events"), ...pairs)
      .pexpire(key("user", user), this.retain.users)
      .pexpire(key("user", user, "events"), this.retain.users)
      .exec();
  }

  async updateUser(id: string, data: Pick<User, "name">): Promise<void> {
    await this.redis.watch(key("user", id));

    if (!(await this.redis.exists(key("user", id))))
      throw new NotFound("User not found");

    const result = this.redis.multi().hset(key("user", id), data).exec();
    if (result == null)
      throw new Conflict("Failed to change user name; please try again.");
  }

  async createRoom(owner: string): Promise<Room> {
    if ((await this.getUser(owner)) == null)
      throw new NotFound("User is not registered");

    const id = uuid();
    const slug = await this.allocateSlug(id);
    const created = new Date();

    await this.redis.hmset(key("room", id), {
      id,
      slug,
      created: +created,
      owner,
    });

    await this.redis.pexpire(key("room", id), this.retain.rooms);
    await this.addUserEvent(owner, { type: "create room", id });

    return { id, slug, created, owner };
  }

  async getRoom(by: "id" | "slug", k: string): Promise<Room | null> {
    const id = by === "id" ? k : await this.resolveSlug(k);
    if (id == null) return null;

    const data = await this.redis.hgetall(key("room", id));
    if (!data || Object.keys(data).length === 0) return null;

    return {
      id: data.id!,
      slug: data.slug!,
      created: date(data.created!),
      owner: data.owner!,
    };
  }

  async writeMessage(room: string, message: StoredMessage): Promise<string> {
    const id = await this.redis.xadd(
      key("room", room, "messages"),
      "*",
      "type",
      message.type,
      "time",
      message.time,
      "data",
      JSON.stringify(message)
    );
    if (id == null) throw new Error("Failed to add message");

    await this.redis
      .pipeline()
      .pexpire(key("room", room), this.retain.rooms)
      .pexpire(key("room", room, "messages"), this.retain.rooms)
      .exec();

    return id;
  }

  async createSession(room: string, actor: string): Promise<Session> {
    const [owner, slug] = await this.redis.hmget(
      key("room", room),
      "owner",
      "slug"
    );
    if (owner == null || slug == null) throw new NotFound("Room not found");

    const role: Role = actor === owner ? "host" : "guest";

    // await this.redis.watch(key("room", room, "connections"));

    const conns = new Set(
      await this.redis.hkeys(key("room", room, "connections"))
    );
    const guests = new Set([...conns].filter((id) => id !== owner));

    if (conns.has(actor)) throw new Conflict("You are already in this room.");
    if (role === "guest" && guests.size > 0)
      throw new Conflict("A guest is already in this room.");

    const id = uuid();

    await this.redis
      .pipeline()
      .hmset(key("connection", id), {
        room,
        owner: actor,
      })
      .hset(key("room", room, "connections"), actor, id)
      .pexpire(key("connection", id), this.retain.rooms)
      .pexpire(key("room", room, "connections"), this.retain.rooms)
      .exec();

    await this.addUserEvent(actor, { type: "join room", id: room, role });

    return {
      id,
      role,
      room: { id: room, slug },
    };
  }

  async getSession(
    id: string
  ): Promise<{ room: string; owner: string } | null> {
    const data = await this.redis.hgetall(key("connection", id));
    if (!data || Object.keys(data).length === 0) return null;

    const user = await this.getUser(data.owner!);
    if (user == null) return null;

    const link = await this.redis.hget(
      key("room", data.room!, "connections"),
      user.id
    );

    return link === id ? { room: data.room!, owner: user.id } : null;
  }

  async deleteSession(id: string): Promise<void> {
    const session = await this.redis.hgetall(key("connection", id));
    const room = session?.room;
    const owner = session?.owner;
    if (!room || !owner) throw new NotFound("Connection not found");

    await this.redis.watch(key("room", room, "connections"));

    const current = await this.redis.hget(
      key("room", room, "connections"),
      owner
    );
    if (current === id) {
      await this.redis
        .multi()
        .hdel(key("room", room, "connections"), owner)
        .exec();
    } else {
      await this.redis.unwatch();
    }

    await this.redis.del(
      key("connection", id),
      key("connection", id, "signal")
    );
  }

  async writeSignal(connection: string, signal: Signal): Promise<string> {
    const id = await this.redis.xadd(
      key("connection", connection, "signal"),
      "*",
      "type",
      signal.type,
      "time",
      Date.now(),
      "data",
      JSON.stringify(signal)
    );
    if (id == null) throw new Error("Failed to add signal");

    await this.redis.pexpire(
      key("connection", connection, "signal"),
      this.retain.rooms
    );

    return id;
  }

  private async allocateSlug(id: string): Promise<string> {
    for (let i = 0; i < 4; i++) {
      const slug = generateSlug();

      if (await this.redis.hsetnx(key("slugs"), slug, id)) {
        return slug;
      }
    }

    throw new Error("Failed to generate room name");
  }

  private resolveSlug(slug: string): Promise<string | null> {
    return this.redis.hget(key("slugs"), slug);
  }
}

export interface User {
  id: string;
  name: string;
  created: Date;
}

export interface Room {
  id: string;
  slug: string;
  created: Date;
  owner: string;
}

export interface Session {
  id: string;
  room: Pick<Room, "id" | "slug">;
  role: Role;
}

export type Role = "host" | "guest";

function date(value: string): Date {
  return new Date(Number.parseInt(value, 10));
}

function key(...spec: Key): string {
  return spec.join(":");
}

/** Defines all valid Redis keys. */
type Key =
  | [root: "user", id: string]
  | [root: "user", id: string, stream: "events"]
  | [root: "slugs"]
  | [root: "room", id: string]
  | [root: "room", id: string, stream: "messages"]
  | [root: "room", id: string, map: "connections"]
  | [root: "connection", id: string]
  | [root: "connection", id: string, stream: "signal"];

type UserEvent =
  | { type: "register" }
  | { type: "create room"; id: string }
  | { type: "join room"; id: string; role: Role };

export abstract class ResponseError extends Error {
  public abstract readonly status: number;
}

export class Unauthorized extends ResponseError {
  public readonly name: string = "Unauthorized";
  public readonly status = 401;

  constructor(message?: string) {
    super(message ?? "Please register first.");
  }
}

export class Forbidden extends ResponseError {
  public readonly name: string = "Forbidden";
  public readonly status = 403;
}

export class NotFound extends ResponseError {
  public readonly name: string = "NotFound";
  public readonly status = 404;
}

export class Conflict extends ResponseError {
  public readonly name: string = "Conflict";
  public readonly status = 409;
}

export class InvalidInput extends ResponseError {
  public readonly name: string = "InvalidInput";
  public readonly status = 422;
}
