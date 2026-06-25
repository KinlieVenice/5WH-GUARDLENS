// SECOND middleware. Opens the AsyncLocalStorage "bubble" for this request so the
// scoped Prisma client and audit logger can read tenant/user without being passed them.
// Runs right after resolveTenant, so tenantId is always available; userId/role are only
// known later (after `authenticate`), which mutates the same live context object.
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
