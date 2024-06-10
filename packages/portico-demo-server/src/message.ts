import type { Signal } from "portico";

import type { Role } from "./data";

export type Event = Message | Signal;

export type Message = Join | Leave | Chat;

export type Request = ChatRequest | LeaveRequest | Signal;

export interface Join {
  type: "join";
  time: number;
  user: User;
  session: string;
  role: Role;
}

export type { Role };

export interface Leave {
  type: "leave";
  time: number;
  user: User;
  session: string;
}

export interface Chat {
  type: "chat";
  time: number;
  user: User;
  session: string;
  message: string;
}

export interface User {
  id: string;
  name: string;
}

export interface ChatRequest {
  type: "chat";
  message: string;
}

export interface LeaveRequest {
  type: "leave";
}

export type Stored<T extends object> = {
  [K in keyof T]: "user" extends K ? string : T[K];
};

export type StoredMessage = Stored<Message>;
