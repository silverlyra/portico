import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";

import type {
  Algorithm,
  Secret,
  SignOptions,
  VerifyOptions,
} from "jsonwebtoken";
import ms from "ms";

export type Environment = typeof process.env;

export interface Config {
  readonly server: ServerConfig;
  readonly redis: RedisConfig;
  readonly auth: AuthConfig;
  readonly retention: RetentionConfig;
}

export interface ServerConfig {
  readonly host: string | null;
  readonly port: number;
}

export interface RedisConfig {
  readonly url: string;
  readonly pool: RedisPoolConfig;
  readonly keyPrefix: string | undefined;
  readonly connectTimeout: number;
  readonly commandTimeout: number;
  readonly keepAlive: number;
}

export interface RedisPoolConfig {
  readonly min: number;
  readonly max: number;
  readonly acquireTimeoutMillis: number;
  readonly evictionRunIntervalMillis: number;
  readonly maxWaitingClients: number;
}

export interface AuthConfig {
  readonly jwt: JWTConfig;
}

export interface RetentionConfig {
  readonly users: number;
  readonly rooms: number;
}

export interface JWTConfig {
  readonly algorithm: Algorithm;
  readonly secret: Secret;
  readonly publicKey: KeyObject | null;
  readonly ttl: number;
  readonly sign: SignOptions;
  readonly verify: VerifyOptions;
}

interface JWTSecret
  extends Pick<JWTConfig, "algorithm" | "secret" | "publicKey"> {
  id: string | null;
}

export function getConfig(env: Environment = process.env): Config {
  return {
    server: getServerConfig(env),
    redis: getRedisConfig(env),
    auth: getAuthConfig(env),
    retention: getRetentionConfig(env),
  };
}

function getServerConfig(env: Environment): ServerConfig {
  return {
    host: env.LISTEN_HOST || null,
    port: int(env.LISTEN_PORT || "3001"),
  };
}

function getRedisConfig(env: Environment): RedisConfig {
  return {
    url: getRedisURL(env),
    pool: getRedisPoolConfig(env),
    keyPrefix: env.REDIS_KEY_PREFIX || undefined,
    connectTimeout: ms(env.REDIS_CONNECT_TIMEOUT || "5s"),
    commandTimeout: ms(env.REDIS_COMMAND_TIMEOUT || "2s"),
    keepAlive: ms(env.REDIS_KEEP_ALIVE || "1s"),
  };
}

function getRedisPoolConfig(env: Environment): RedisPoolConfig {
  const min = int(env.REDIS_POOL_MIN || "2");
  const max = int(env.REDIS_POOL_MAX || "120");
  const defaultWait = Math.ceil(max / 10);

  return {
    min,
    max,
    acquireTimeoutMillis: ms(env.REDIS_POOL_ACQUIRE_TIMEOUT || "2.5s"),
    evictionRunIntervalMillis: ms(env.REDIS_POOL_EVICT_INTERVAL_MS || "10s"),
    maxWaitingClients: int(env.REDIS_POOL_MAX_PENDING || `${defaultWait}`),
  };
}

function getRedisURL(env: Environment): string {
  if (env.REDIS_URL) return env.REDIS_URL;

  const protocol = env.REDIS_TLS ? "rediss" : "redis";
  const auth = `${env.REDIS_USER || "default"}:${env.REDIS_PASSWORD}`;
  const host = `${env.REDIS_HOST}:${env.REDIS_PORT || "6379"}`;
  return `${protocol}://${auth}@${host}`;
}

function getAuthConfig(env: Environment): AuthConfig {
  return {
    jwt: getJWTConfig(env),
  };
}

function getRetentionConfig(env: Environment): RetentionConfig {
  return {
    users: ms(env.USER_TTL || "7d"),
    rooms: ms(env.ROOM_TTL || "30h"),
  };
}

function getJWTConfig(env: Environment): JWTConfig {
  const { id, algorithm, secret, publicKey } = getJWTSecret(env);

  const ttl = ms(env.JWT_TTL || env.USER_TTL || "7d");
  const issuer = env.JWT_ISSUER || "https://github.com/silverlyra/portico";

  return {
    algorithm,
    secret,
    publicKey,
    ttl,
    sign: {
      algorithm,
      keyid: id || undefined,
      expiresIn: ttl,
      issuer,
    },
    verify: {
      algorithms: [algorithm],
      issuer,
      maxAge: Math.floor(Math.max(ttl * 1.1, ttl + 60_000)),
    },
  };
}

function getJWTSecret(env: Environment): JWTSecret {
  const secretSpec = env.JWT_SECRET;
  if (!secretSpec) throw ConfigError.required("JWT_SECRET");

  const contents = secretSpec.endsWith(".pem")
    ? readFileSync(secretSpec, "utf-8")
    : secretSpec;

  try {
    const key = createPrivateKey(contents);
    const publicKey = createPublicKey(key);
    const fingerprint = keyFingerprint(publicKey);
    const algorithm = keyAlgorithm(key);

    return {
      id: fingerprint,
      secret: key,
      publicKey,
      algorithm,
    };
  } catch (err) {
    if (contents.includes("PRIVATE KEY")) throw err;

    const algorithm: Algorithm = contents.length >= 16 ? "HS512" : "HS256";

    return { id: null, algorithm, secret: contents, publicKey: null };
  }

  function keyAlgorithm(key: KeyObject): Algorithm {
    const details = key.asymmetricKeyDetails;
    const curve = details?.namedCurve;
    const length = details?.modulusLength;

    if (key.asymmetricKeyType === "ec" && curve) {
      switch (curve) {
        case "prime256v1":
          return "ES256";
        case "secp384r1":
          return "ES384";
        case "secp521r1":
          return "ES512";
        default:
          throw new ConfigError(
            `Unsupported EC curve in JWT secret ${curve || "(unknown)"}`
          );
      }
    }

    if (key.asymmetricKeyType === "rsa" && length) {
      if (length < 3000) return "RS256";
      if (length < 4000) return "RS384";
      return "RS512";
    }

    throw new ConfigError(
      `Unsupported JWT key type ${key.asymmetricKeyType || "(unknown)"}`
    );
  }

  function keyFingerprint(key: KeyObject): string {
    // Export the public key in PEM format
    const publicKeyPem = key.export({
      type: "spki",
      format: "der",
    });

    // Create a fingerprint by hashing the public key using SHA-256
    const hash = createHash("sha256");

    hash.update(publicKeyPem);
    return hash.digest("hex");
  }
}

function int(value: string): number;
function int(value: string | undefined): number | undefined;
function int(value: string | undefined): number | undefined {
  return typeof value === "string" ? Number.parseInt(value, 10) : undefined;
}

export class ConfigError extends Error {
  public readonly name: string = "ConfigError";

  static required(name: string): ConfigError {
    return new ConfigError(`Environment variable $${name} is required`);
  }
}
