import { getContext } from "../../shared/context/request-context.js";

// Stage 0: structured-log audit. The AuditLog DB write lands in Stage 1.2.
// Stamps impersonatedBy from context so the impersonation seam is auditable now.
export const audit = {
  async record(input: { action: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    const ctx = getContext();
    console.info("[audit]", JSON.stringify({
      ...input,
      tenantId: ctx?.tenantId, actorUserId: ctx?.userId, impersonatedBy: ctx?.impersonatedBy, at: new Date().toISOString(),
    }));
  },
};
