// The audit trail. Records security-relevant actions (who did what, in which tenant, while
// impersonating whom) as APPEND-ONLY rows in the AuditLog table (DB triggers block edit/delete).
// Same signature as the Stage 0 seam — callers are unchanged; only the implementation moved from
// console to a real table. Runs on the tenant-scoped client, so tenantId is auto-stamped.
import { requireContext } from "../../shared/context/request-context.js";
import { getScopedPrisma } from "../../shared/prisma/index.js";

export const audit = {
  // Write one audit row. actorUserId/impersonatedBy/ipAddress are read from the request context;
  // tenantId is stamped by the Prisma extension; `at` is defaulted by the DB.
  async record(input: { action: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    const ctx = requireContext();
    await getScopedPrisma().auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata === undefined ? undefined : (input.metadata as object),
        actorUserId: ctx.userId ?? null,
        impersonatedBy: ctx.impersonatedBy ?? null,
        ipAddress: ctx.ip ?? null,
      },
    });
  },
};
