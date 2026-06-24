import { runWithContext, type RequestContext } from "../../shared/context/request-context.js";

// Runs fn inside a tenant context and awaits it WITHIN that scope, so the
// scoped Prisma client (which reads context at execution time) sees it.
// Tests must use this rather than `runWithContext(ctx, () => prisma.x.op())`,
// whose returned lazy PrismaPromise would otherwise execute after the scope exits.
export function asContext<T>(ctx: RequestContext, fn: () => Promise<T> | T): Promise<T> {
  return runWithContext(ctx, async () => await fn());
}

export function asTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
  return asContext({ tenantId }, fn);
}
