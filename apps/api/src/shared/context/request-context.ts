// Request-scoped "who is asking" store, built on Node's AsyncLocalStorage (ALS).
// This is the heart of tenant isolation: instead of threading `tenantId` through
// every function call, we stash it in ALS at the start of a request and let the
// Prisma extension (tenant-extension.ts) read it back automatically on every query.
// ALS keeps a separate value per async call-chain, so concurrent requests never
// see each other's context.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@prisma/client";

// What we know about the current request. `tenantId` is always set (by the
// resolveTenant middleware); the user fields are filled in later by `authenticate`
// once a valid access token is verified (so login/refresh routes have tenant-only ctx).
export type RequestContext = {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  role?: Role;
  impersonatedBy?: string; // platform admin id when this is an impersonation session
  ip?: string;             // client IP, captured in loadContext for the audit trail
};

// Thrown whenever scoped code runs with NO context at all. We throw instead of
// returning everything, so a missing-context bug fails closed (no data) rather
// than open (every tenant's data). See tenant-extension.ts and raw.ts.
export class MissingContextError extends Error {
  constructor() {
    super("No tenant context: refusing to run an unscoped query (fail-closed).");
    this.name = "MissingContextError";
  }
}

const als = new AsyncLocalStorage<RequestContext>();
// Run `fn` (and everything it awaits) with `ctx` as the active context. The
// loadContext middleware wraps the rest of the request in this.
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}
// Read the current context, or undefined if we're outside any request. Used by
// code that can tolerate "no context" (e.g. the Prisma extension's own check).
export function getContext(): RequestContext | undefined {
  return als.getStore();
}
// Read the current context or fail closed. Used where running without a tenant
// would be a security bug (raw SQL, property scoping).
export function requireContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new MissingContextError();
  return ctx;
}
