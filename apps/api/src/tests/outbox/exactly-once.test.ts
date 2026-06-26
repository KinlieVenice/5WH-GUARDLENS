import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { enqueueOutbox } from "../../modules/outbox/outbox.producer.js";
import { register, clearHandlers } from "../../modules/outbox/outbox.registry.js";
import { runRelayOnce } from "../../modules/outbox/outbox.relay.js";

// A representative consumer side-effect table, created in TEST setup so the product schema stays
// to just OutboxEvent. The dedupeKey PRIMARY KEY is the idempotency guard the real consumers
// (LogbookEntry, Notification) will carry in later stages.
beforeAll(async () => {
  await basePrisma.$executeRawUnsafe(
    "CREATE TABLE IF NOT EXISTS `outbox_test_sink` (`dedupeKey` VARCHAR(191) NOT NULL PRIMARY KEY, `tenantId` VARCHAR(191) NOT NULL)",
  );
});
afterAll(async () => { await basePrisma.$executeRawUnsafe("DROP TABLE IF EXISTS `outbox_test_sink`"); await resetDb(); clearHandlers(); });

let tenantId = "";
beforeEach(async () => {
  await resetDb(); clearHandlers();
  await basePrisma.$executeRawUnsafe("TRUNCATE `outbox_test_sink`");
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t-once" } });
  tenantId = t.id;
});

describe("outbox exactly-once across a crash", () => {
  it("re-dispatch after a crash writes the side-effect only once (dedupeKey)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let calls = 0;
      // Idempotent consumer: insert the side-effect keyed by a deterministic dedupeKey; a unique
      // violation means "already done" → swallow (success). On the FIRST call, throw AFTER the
      // insert to simulate a crash between the side-effect commit and the relay marking PROCESSED.
      register("test.once", async (e) => {
        calls++;
        const dedupeKey = `${e.id}:onceconsumer`;
        try {
          await basePrisma.$executeRawUnsafe(
            "INSERT INTO `outbox_test_sink` (`dedupeKey`, `tenantId`) VALUES (?, ?)", dedupeKey, e.tenantId,
          );
        } catch (err) {
          if (/Duplicate entry|ER_DUP_ENTRY|UNIQUE/i.test(String(err))) return; // idempotent: already processed
          throw err;
        }
        if (calls === 1) throw new Error("simulated crash after side-effect, before PROCESSED");
      });

      await basePrisma.$transaction((tx) => enqueueOutbox(tx, { tenantId, type: "test.once", payload: {} }));

      // Attempt 1: side-effect inserted, then "crash" → relay records a failure (row stays PENDING).
      const r1 = await runRelayOnce();
      expect(r1).toEqual({ processed: 0, failed: 1 });
      const sinkAfter1 = (await basePrisma.$queryRawUnsafe<{ c: bigint }[]>("SELECT COUNT(*) c FROM `outbox_test_sink`"))[0]!.c;
      expect(Number(sinkAfter1)).toBe(1);

      // Make the row due again (skip backoff wait), then re-dispatch.
      await basePrisma.outboxEvent.updateMany({ where: { type: "test.once" }, data: { nextAttemptAt: new Date() } });
      const r2 = await runRelayOnce();
      expect(r2).toEqual({ processed: 1, failed: 0 });

      // Exactly one side-effect total; the event is PROCESSED; the handler ran twice.
      const sinkFinal = (await basePrisma.$queryRawUnsafe<{ c: bigint }[]>("SELECT COUNT(*) c FROM `outbox_test_sink`"))[0]!.c;
      expect(Number(sinkFinal)).toBe(1);
      expect(calls).toBe(2);
      const row = await basePrisma.outboxEvent.findFirstOrThrow({ where: { type: "test.once" } });
      expect(row.status).toBe("PROCESSED");
    } finally {
      errSpy.mockRestore();
    }
  });
});
