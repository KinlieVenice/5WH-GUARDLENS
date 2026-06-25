// Redis-backed counters for rate limiting and login-lockout. Using Redis (not in-memory)
// means the limits hold even across multiple API instances. The trick throughout: INCR a
// key, and on the FIRST increment set a TTL, so the counter auto-resets after the window.
import { redis } from "../redis/client.js";
import { env } from "../../config/env.js";

// Generic fixed-window limiter factory. consume(id) returns true while under `limit`
// within `windowSeconds`, false once the window is exhausted.
export function rateLimit(opts: { keyPrefix: string; limit: number; windowSeconds: number }) {
  return {
    async consume(id: string): Promise<boolean> {
      const key = `rl:${opts.keyPrefix}:${id}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, opts.windowSeconds);
      return n <= opts.limit;
    },
  };
}

// Login-failure tracking (keyed per "tenantId:email"). Drives account lockout in
// auth.service.login: too many failures → 429, cleared on a successful login.
const failKey = (id: string) => `login:fail:${id}`;
// Count one bad login attempt (starts the lockout timer on the first failure).
export async function recordFailure(id: string): Promise<void> {
  const key = failKey(id);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, env.LOGIN_LOCK_SECONDS);
}
// How many failures are currently on record (0 if none / window expired).
export async function failureCount(id: string): Promise<number> {
  return Number((await redis.get(failKey(id))) ?? 0);
}
// Wipe the failure counter after a successful login.
export async function clearFailures(id: string): Promise<void> {
  await redis.del(failKey(id));
}
