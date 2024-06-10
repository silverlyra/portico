import type { Signal } from "portico";
import type { Event, Message, Request, Role } from "portico-demo-server";

export class Client {
  public readonly base: URL;

  constructor(base = "/api/") {
    this.base = new URL(base, window.location.href);
  }

  async getUser(): Promise<User | null> {
    try {
      const { user } = await this.get<UserResponse>("/user");
      return user;
    } catch (err) {
      if (err instanceof ResponseError && err.status === 401) {
        return null;
      }

      throw err;
    }
  }

  async register(input: RegisterRequest): Promise<User> {
    const { user }: UserResponse = await this.post("/user", input);
    return user;
  }

  async updateUser(input: RegisterRequest): Promise<User> {
    const { user }: UserResponse = await this.put("/user", input);
    return user;
  }

  async createRoom(): Promise<Room> {
    const { room }: RoomResponse = await this.post("/room", { slug: null });
    return room;
  }

  async getRoom(slug: string): Promise<Room> {
    const { room } = await this.get<RoomResponse>(`/room/${slug}`);
    return room;
  }

  async createSession({ slug }: { slug: string }): Promise<Session> {
    const { session }: SessionResponse = await this.post(
      `/room/${slug}/join`,
      {}
    );
    return session;
  }

  joinSession({ id }: Session): Channel {
    const url = this.url(`/session/${id}`);

    if (url.protocol === "http") url.protocol = "ws";
    else if (url.protocol === "https") url.protocol = "wss";

    return new Channel(new WebSocket(url));
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(this.url(path), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });

    return this.receive<T>(response);
  }

  private post<T, V extends object>(path: string, input: V): Promise<T> {
    return this.send("POST", path, input);
  }

  private put<T, V extends object>(path: string, input: V): Promise<T> {
    return this.send("PUT", path, input);
  }

  private async send<T, V extends object>(
    method: "POST" | "PUT",
    path: string,
    input: V
  ): Promise<T> {
    const response = await fetch(this.url(path), {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      credentials: "include",
    });

    return this.receive<T>(response);
  }

  private url(path: string): URL {
    return new URL(path.replace(/^\//, ""), this.base);
  }

  private async receive<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("Content-Type");
    const isJSON =
      contentType === "application/json" ||
      contentType === "application/json; charset=utf-8";

    if (response.status >= 400) {
      const details: ErrorResponse | null = isJSON
        ? await response.json()
        : null;

      throw new ResponseError(response, details);
    }
    if (!isJSON) {
      throw new TypeError(
        `Server returned ${contentType || "unknown content"}`
      );
    }

    const data = await response.json();
    return data;
  }
}

export class Channel {
  public onopen?: () => void;
  public onclose?: (event: CloseEvent) => void;
  private _onmessage?: (message: Message) => void;
  private _onsignal?: (signal: Signal) => void;

  private queue: Event[] = [];

  constructor(private readonly ws: WebSocket) {
    ws.onopen = this.opened.bind(this);
    ws.onmessage = this.receive.bind(this);
    ws.onclose = this.closed.bind(this);
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  get state(): ChannelState {
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      case WebSocket.CLOSING:
        return "closing";
      case WebSocket.CLOSED:
        return "closed";
    }

    throw new TypeError("unreachable");
  }

  public close() {
    this.ws.close();
  }

  public send(request: Request) {
    this.ws.send(JSON.stringify(request));
  }

  get onmessage(): ((message: Message) => void) | undefined {
    return this._onmessage;
  }

  set onmessage(handler: ((message: Message) => void) | undefined) {
    const trigger = this._onmessage == null && handler != null;
    this._onmessage = handler;
    if (trigger) setTimeout(this.deliverQueued.bind(this), 0);
  }

  get onsignal(): ((signal: Signal) => void) | undefined {
    return this._onsignal;
  }

  set onsignal(handler: ((signal: Signal) => void) | undefined) {
    const trigger = this._onsignal == null && handler != null;
    this._onsignal = handler;
    if (trigger) setTimeout(this.deliverQueued.bind(this), 0);
  }

  private opened() {
    this.onopen?.();
  }

  private receive(event: MessageEvent<string>) {
    if (typeof event.data !== "string") return;

    const message: Event = JSON.parse(event.data);

    this.deliver(message);
  }

  private deliver(message: Event) {
    switch (message.type) {
      case "ice":
      case "sdp":
        if (this.onsignal) this.onsignal(message);
        else this.queue.push(message);
        break;

      case "join":
      case "leave":
      case "chat":
        if (this.onmessage) this.onmessage(message);
        else this.queue.push(message);
    }
  }

  private deliverQueued() {
    const pending = this.queue;
    this.queue = [];

    for (const event of pending) this.deliver(event);
  }

  private closed(event: CloseEvent) {
    this.onclose?.(event);
  }
}

export type ChannelState = "connecting" | "open" | "closing" | "closed";

export class ResponseError extends Error {
  public readonly name: string = "ResponseError";
  public readonly response: Response;
  private readonly details: ErrorResponse | null;

  constructor(response: Response, details?: ErrorResponse | null) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.response = response;
    this.details = details ?? null;
  }

  get description(): string {
    return this.details?.message ?? "An unexpected server error occurred.";
  }

  get status(): number {
    return this.response.status;
  }

  get code(): string | undefined {
    return this.details?.code;
  }
}

export interface ErrorResponse {
  code?: string;
  message: string;
}

export interface User {
  id: string;
  name: string;
  created: string;
}

export interface Room {
  id: string;
  slug: string;
  created: string;
  owner: Pick<User, "id" | "name">;
}

export interface Session {
  id: string;
  room: Pick<Room, "id" | "slug">;
  role: Role;
}

export type RegisterRequest = Pick<User, "name">;

export interface UserResponse {
  user: User;
}

export interface RoomResponse {
  room: Room;
}

export interface SessionResponse {
  session: Session;
}
