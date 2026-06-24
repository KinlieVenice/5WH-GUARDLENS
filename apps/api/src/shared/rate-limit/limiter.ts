import { redis } from "../redis/client.js";
import { env } from "../../config/env.js";

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

const failKey = (id: string) => `login:fail:${id}`;
export async function recordFailure(id: string): Promise<void> {
  const key = failKey(id);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, env.LOGIN_LOCK_SECONDS);
}
export async function failureCount(id: string): Promise<number> {
  return Number((await redis.get(failKey(id))) ?? 0);
}
export async function clearFailures(id: string): Promise<void> {
  await redis.del(failKey(id));
}
