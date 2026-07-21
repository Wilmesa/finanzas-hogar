import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { RedisService } from "./redis.service.js";

export const SESSION_COOKIE = "finanzas_session";

export interface StoredSession {
  userId: string;
  memberId: string;
  householdId: string;
  passwordVersion: number;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function sessionKey(token: string) {
  return `auth:session:${digest(token)}`;
}

export function memberSessionsKey(memberId: string) {
  return `auth:member-sessions:${digest(memberId)}`;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

@Injectable()
export class SessionStore {
  constructor(private readonly redis: RedisService) {}

  ttlSeconds() {
    return boundedInteger(
      process.env.SESSION_TTL_SECONDS,
      43_200,
      900,
      604_800,
    );
  }

  async create(
    input: Omit<StoredSession, "csrfToken" | "issuedAt" | "expiresAt">,
  ) {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const ttl = this.ttlSeconds();
    const issuedAt = Date.now();
    const record: StoredSession = {
      ...input,
      csrfToken,
      issuedAt,
      expiresAt: issuedAt + ttl * 1000,
    };
    const key = sessionKey(token);
    const memberKey = memberSessionsKey(input.memberId);
    await this.redis.client
      .multi()
      .set(key, JSON.stringify(record), { EX: ttl })
      .sAdd(memberKey, key)
      .expire(memberKey, ttl)
      .exec();
    return { token, record, ttl };
  }

  async get(token: string): Promise<StoredSession | null> {
    const value = await this.redis.client.get(sessionKey(token));
    if (!value) return null;
    try {
      const record = JSON.parse(value) as StoredSession;
      if (record.expiresAt <= Date.now()) {
        await this.destroy(token, record.memberId);
        return null;
      }
      return record;
    } catch {
      await this.redis.client.del(sessionKey(token));
      return null;
    }
  }

  async destroy(token: string, memberId?: string) {
    const key = sessionKey(token);
    const resolvedMemberId = memberId ?? (await this.get(token))?.memberId;
    const commands = this.redis.client.multi().del(key);
    if (resolvedMemberId)
      commands.sRem(memberSessionsKey(resolvedMemberId), key);
    await commands.exec();
  }

  async destroyAll(memberId: string) {
    const memberKey = memberSessionsKey(memberId);
    const keys = await this.redis.client.sMembers(memberKey);
    if (keys.length) await this.redis.client.del(keys);
    await this.redis.client.del(memberKey);
  }

  async list(memberId: string): Promise<StoredSession[]> {
    const memberKey = memberSessionsKey(memberId);
    const keys = await this.redis.client.sMembers(memberKey);
    if (!keys.length) return [];
    const values = await this.redis.client.mGet(keys);
    return values.flatMap((value) => {
      if (!value) return [];
      try {
        const session = JSON.parse(value) as StoredSession;
        return session.expiresAt > Date.now() ? [session] : [];
      } catch {
        return [];
      }
    });
  }

  async consumeLoginAttempt(identifier: string, ip: string) {
    const maximum = boundedInteger(process.env.LOGIN_MAX_ATTEMPTS, 5, 3, 20);
    const windowSeconds = boundedInteger(
      process.env.LOGIN_WINDOW_SECONDS,
      900,
      60,
      86_400,
    );
    const keys = [
      `auth:login:id:${digest(identifier.toLowerCase())}`,
      `auth:login:ip:${digest(ip)}`,
    ];
    for (const key of keys) {
      const count = Number(
        await this.redis.client.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          { keys: [key], arguments: [String(windowSeconds)] },
        ),
      );
      if (count > maximum) return false;
    }
    return true;
  }

  async clearLoginAttempts(identifier: string, ip: string) {
    await this.redis.client.del([
      `auth:login:id:${digest(identifier.toLowerCase())}`,
      `auth:login:ip:${digest(ip)}`,
    ]);
  }
}
