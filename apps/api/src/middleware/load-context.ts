import type { RequestHandler } from "express";
import { runWithContext, type RequestContext } from "../shared/context/request-context.js";

// Wraps the remainder of the chain in the AsyncLocalStorage context so the
// scoped Prisma client and audit logger read it automatically.
export const loadContext: RequestHandler = (_req, res, next) => {
  const claims = res.locals.claims;
  const ctx: RequestContext = {
    tenantId: res.locals.tenant.id,
    userId: claims?.userId,
    sessionId: claims?.sessionId,
    role: claims?.role,
    impersonatedBy: claims?.impersonatedBy,
  };
  runWithContext(ctx, () => next());
};
