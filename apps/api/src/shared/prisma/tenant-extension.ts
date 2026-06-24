import { basePrisma } from "./base-client.js";
import { getContext, MissingContextError } from "../context/request-context.js";

export const EXEMPT_MODELS = ["Plan", "SharedIntelligenceEntry"] as const;
const exempt = new Set<string>(EXEMPT_MODELS);

export const scopedPrisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && exempt.has(model)) return query(args);
        const ctx = getContext();
        if (!ctx) throw new MissingContextError();
        const tenantId = ctx.tenantId;
        const a = (args ?? {}) as Record<string, unknown>;

        if (operation === "create") {
          a.data = { ...((a.data as object) ?? {}), tenantId };
        } else if (operation === "createMany") {
          const data = a.data;
          a.data = Array.isArray(data)
            ? data.map((d) => ({ ...(d as object), tenantId }))
            : { ...((data as object) ?? {}), tenantId };
        } else if (operation === "upsert") {
          a.where = { ...((a.where as object) ?? {}), tenantId };
          a.create = { ...((a.create as object) ?? {}), tenantId };
          a.update = { ...((a.update as object) ?? {}), tenantId };
        } else {
          a.where = { ...((a.where as object) ?? {}), tenantId };
          if (operation === "update" || operation === "updateMany") {
            a.data = { ...((a.data as object) ?? {}), tenantId };
          }
        }
        return query(a);
      },
    },
  },
});

export type ScopedPrisma = typeof scopedPrisma;
