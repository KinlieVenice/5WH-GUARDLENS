import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@prisma/client";

export type RequestContext = {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  role?: Role;
  impersonatedBy?: string;
};

export class MissingContextError extends Error {
  constructor() {
    super("No tenant context: refusing to run an unscoped query (fail-closed).");
    this.name = "MissingContextError";
  }
}

const als = new AsyncLocalStorage<RequestContext>();
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}
export function getContext(): RequestContext | undefined {
  return als.getStore();
}
export function requireContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new MissingContextError();
  return ctx;
}
