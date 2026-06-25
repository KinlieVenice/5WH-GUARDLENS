// Proves: the limiter counts failures per key, enforces the max, and clears on success (end-to-end through Redis).
// Proves: the limiter counts failures per key, enforces the max, and clears on success (end-to-end through Redis).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { redis } from "../../shared/redis/client.js";
import { rateLimit, recordFailure, failureCount, clearFailures } from "../../shared/rate-limit/limiter.js";

describe("redis rate limiter (shared across instances)", () => {
  beforeEach(async () => { await redis.flushdb(); });
  afterAll(async () => { await redis.quit(); });

  it("two independent limiter instances share the same counter", async () => {
    const a = rateLimit({ keyPrefix: "t", limit: 3, windowSeconds: 60 });
    const b = rateLimit({ keyPrefix: "t", limit: 3, windowSeconds: 60 });
    expect(await a.consume("ip1")).toBe(true);
    expect(await a.consume("ip1")).toBe(true);
    expect(await b.consume("ip1")).toBe(true);   // 3rd, across "instance" b
    expect(await b.consume("ip1")).toBe(false);  // 4th — blocked
  });

  it("records and clears login failures", async () => {
    await recordFailure("u@x");
    await recordFailure("u@x");
    expect(await failureCount("u@x")).toBe(2);
    await clearFailures("u@x");
    expect(await failureCount("u@x")).toBe(0);
  });
});
