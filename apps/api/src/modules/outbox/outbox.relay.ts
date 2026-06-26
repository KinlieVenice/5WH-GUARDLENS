// The relay drains the outbox. It runs CROSS-TENANT (no request context of its own), so it uses
// the base client directly — like jobs/token-cleanup.ts — and re-establishes each event's tenant
// context before dispatch. Rows are claimed with FOR UPDATE SKIP LOCKED so two relays never grab
// the same row. The outbox row is the single retry owner: success → PROCESSED, failure → backoff,
// and after OUTBOX_MAX_ATTEMPTS → FAILED (dead-letter).
import { basePrisma } from "../../shared/prisma/base-client.js";
import { runWithContext } from "../../shared/context/request-context.js";
import { getHandler, type OutboxEventView } from "./outbox.registry.js";
import { env } from "../../config/env.js";

type Claimed = OutboxEventView & { attempts: number };

// Claim up to OUTBOX_CLAIM_BATCH due rows in one short transaction: select skipping locked rows,
// then lease them (lockedUntil) so other relays/this-relay-after-crash don't double-claim.
async function claimBatch(): Promise<Claimed[]> {
  return basePrisma.$transaction(async (tx) => {
    const limit = Number(env.OUTBOX_CLAIM_BATCH);
    const due = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM \`OutboxEvent\`
         WHERE status='PENDING' AND nextAttemptAt<=NOW(3) AND (lockedUntil IS NULL OR lockedUntil<NOW(3))
         ORDER BY nextAttemptAt ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
    );
    if (due.length === 0) return [];
    const ids = due.map((r) => r.id);
    const lockUntil = new Date(Date.now() + Number(env.OUTBOX_LOCK_MS));
    await tx.$executeRawUnsafe(
      `UPDATE \`OutboxEvent\` SET lockedUntil=? WHERE id IN (${ids.map(() => "?").join(",")})`,
      lockUntil, ...ids,
    );
    const rows = await tx.outboxEvent.findMany({ where: { id: { in: ids } } });
    return rows.map((e) => ({ id: e.id, tenantId: e.tenantId, type: e.type, payload: e.payload, attempts: e.attempts }));
  });
}

async function processOne(e: Claimed): Promise<"processed" | "failed"> {
  try {
    const handler = getHandler(e.type);
    if (!handler) throw new Error(`no outbox handler for type: ${e.type}`);
    await runWithContext({ tenantId: e.tenantId }, () =>
      handler({ id: e.id, tenantId: e.tenantId, type: e.type, payload: e.payload }),
    );
    await basePrisma.outboxEvent.update({
      where: { id: e.id }, data: { status: "PROCESSED", processedAt: new Date(), lockedUntil: null },
    });
    return "processed";
  } catch {
    const attempts = e.attempts + 1;
    const dead = attempts >= Number(env.OUTBOX_MAX_ATTEMPTS);
    const backoff = Math.min(Number(env.OUTBOX_BACKOFF_BASE_MS) * 2 ** attempts, Number(env.OUTBOX_BACKOFF_CAP_MS));
    await basePrisma.outboxEvent.update({
      where: { id: e.id },
      data: {
        attempts, lockedUntil: null,
        status: dead ? "FAILED" : "PENDING",
        ...(dead ? {} : { nextAttemptAt: new Date(Date.now() + backoff) }),
      },
    });
    return "failed";
  }
}

// Drain one batch. Returns counts so the worker (and tests) can observe progress.
export async function runRelayOnce(): Promise<{ processed: number; failed: number }> {
  const batch = await claimBatch();
  let processed = 0, failed = 0;
  for (const e of batch) {
    if ((await processOne(e)) === "processed") processed++; else failed++;
  }
  return { processed, failed };
}
