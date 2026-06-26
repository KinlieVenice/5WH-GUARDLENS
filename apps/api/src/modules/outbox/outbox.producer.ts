// The producer side of the outbox. Callers append an event in the SAME transaction as their
// state change, so the event and the change commit atomically (a crash/rollback loses both).
// Usage: await db.$transaction(async (tx) => { ...write state...; await enqueueOutbox(tx, {...}); });
import type { Prisma } from "@prisma/client";

export async function enqueueOutbox(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; type: string; payload: unknown },
): Promise<void> {
  await tx.outboxEvent.create({
    data: { tenantId: input.tenantId, type: input.type, payload: input.payload as Prisma.InputJsonValue },
  });
}
