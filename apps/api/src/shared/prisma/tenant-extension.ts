import { basePrisma } from "./base-client.js";
import { getContext, MissingContextError } from "../context/request-context.js";

export const EXEMPT_MODELS = ["Plan", "SharedIntelligenceEntry"] as const;
const exempt = new Set<string>(EXEMPT_MODELS);

// Write ops where we must inject tenantId into `data`.
const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

/**
 * Creates a Prisma extension that injects tenantId from the context captured
 * at call time. Capturing at call time (rather than inside the query callback)
 * ensures correctness even when Prisma lazily executes queries after the ALS
 * context has exited (e.g. when the PrismaPromise is awaited outside the run()).
 */
export function makeScopedPrisma() {
  // Capture context NOW — before the lazy PrismaPromise executes.
  const capturedCtx = getContext();

  return basePrisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && exempt.has(model)) return query(args);
          const ctx = capturedCtx;
          if (!ctx) throw new MissingContextError();
          const tenantId = ctx.tenantId;
          const a = (args ?? {}) as Record<string, unknown>;

          // Reads / updates / deletes: constrain by tenantId via where.
          if (!CREATE_OPS.has(operation)) {
            a.where = { ...(a.where as object ?? {}), tenantId };
          }

          // Writes: stamp tenantId into data (and nested create on upsert).
          if (operation === "create") {
            a.data = { ...(a.data as object ?? {}), tenantId };
          } else if (operation === "createMany") {
            const data = a.data;
            a.data = Array.isArray(data)
              ? data.map((d) => ({ ...(d as object), tenantId }))
              : { ...(data as object), tenantId };
          } else if (operation === "upsert") {
            a.where = { ...(a.where as object ?? {}), tenantId };
            a.create = { ...(a.create as object ?? {}), tenantId };
          }
          return query(a);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof makeScopedPrisma>;
