import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { enqueueOutbox } from "../../modules/outbox/outbox.producer.js";

let tenantId = "";
beforeEach(async () => { await resetDb(); const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t-ob" } }); tenantId = t.id; });
afterAll(async () => { await resetDb(); });

describe("enqueueOutbox same-transaction guarantee", () => {
  it("commits the event alongside the state change", async () => {
    await basePrisma.$transaction(async (tx) => {
      await tx.property.create({ data: { tenantId, name: "P" } });
      await enqueueOutbox(tx, { tenantId, type: "test.evt", payload: { a: 1 } });
    });
    expect(await basePrisma.outboxEvent.count()).toBe(1);
    expect(await basePrisma.property.count()).toBe(1);
  });

  it("a rolled-back transaction leaves NO event and NO state change", async () => {
    await expect(basePrisma.$transaction(async (tx) => {
      await tx.property.create({ data: { tenantId, name: "P2" } });
      await enqueueOutbox(tx, { tenantId, type: "test.evt", payload: {} });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await basePrisma.outboxEvent.count()).toBe(0);
    expect(await basePrisma.property.count()).toBe(0);
  });
});
