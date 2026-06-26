import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { resetDb } from "../helpers/test-db.js";
import { enqueueOutbox } from "../../modules/outbox/outbox.producer.js";
import { register, clearHandlers } from "../../modules/outbox/outbox.registry.js";
import { runRelayOnce } from "../../modules/outbox/outbox.relay.js";

async function enqueue(tenantId: string, type: string, payload: unknown = {}) {
  await basePrisma.$transaction((tx) => enqueueOutbox(tx, { tenantId, type, payload }));
}

let tenantId = "";
beforeEach(async () => {
  await resetDb(); clearHandlers();
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t-relay" } });
  tenantId = t.id;
});
afterAll(async () => { await resetDb(); clearHandlers(); });

describe("outbox relay", () => {
  it("dispatches to the handler and marks the row PROCESSED", async () => {
    let seen = 0;
    register("test.ok", async () => { seen++; });
    await enqueue(tenantId, "test.ok");
    const r = await runRelayOnce();
    expect(r).toEqual({ processed: 1, failed: 0 });
    expect(seen).toBe(1);
    const row = await basePrisma.outboxEvent.findFirstOrThrow({ where: { type: "test.ok" } });
    expect(row.status).toBe("PROCESSED");
    expect(row.processedAt).not.toBeNull();
  });

  it("re-establishes the event's tenant context for the handler", async () => {
    // two tenants, one property each; event for tenantId → handler's scoped count sees only 1
    const other = await basePrisma.tenant.create({ data: { name: "O", slug: "o-relay" } });
    await basePrisma.property.create({ data: { tenantId, name: "A" } });
    await basePrisma.property.create({ data: { tenantId: other.id, name: "B" } });
    let scopedCount = -1;
    register("test.ctx", async () => { scopedCount = await getScopedPrisma().property.count(); });
    await enqueue(tenantId, "test.ctx");
    await runRelayOnce();
    expect(scopedCount).toBe(1); // only tenantId's property, proving runWithContext({tenantId})
  });

  it("backs off on failure and dead-letters to FAILED after MAX_ATTEMPTS", async () => {
    register("test.fail", async () => { throw new Error("always"); });
    await enqueue(tenantId, "test.fail");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 5; i++) {
        // make the row due again (skip the backoff wait), then run
        await basePrisma.outboxEvent.updateMany({ where: { type: "test.fail" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
        await runRelayOnce();
      }
      const row = await basePrisma.outboxEvent.findFirstOrThrow({ where: { type: "test.fail" } });
      expect(row.status).toBe("FAILED");
      expect(row.attempts).toBe(5);
      expect(row.lockedUntil).toBeNull();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("two concurrent relays never process the same row (SKIP LOCKED)", async () => {
    let calls = 0;
    register("test.race", async () => { calls++; });
    await enqueue(tenantId, "test.race");
    const [a, b] = await Promise.all([runRelayOnce(), runRelayOnce()]);
    expect(a.processed + b.processed).toBe(1); // exactly one relay handled it
    expect(calls).toBe(1);
  });
});
