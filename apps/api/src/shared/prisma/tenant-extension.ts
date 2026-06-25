// The tenant-isolation engine. This Prisma "extension" intercepts EVERY query on
// EVERY model and automatically pins it to the current request's tenant — reads get
// a `where: { tenantId }` filter, writes get `tenantId` stamped into the data. The
// result: application code (controllers/services) never has to remember to filter by
// tenant, and *cannot* forget to. If there's no context, it throws (fail-closed).
import { basePrisma } from "./base-client.js";
import { getContext, MissingContextError } from "../context/request-context.js";

// The only models that are NOT tenant-scoped — they're genuinely global/shared data.
// Test-locked: leak-suite/allowlist-lock.test.ts asserts this list verbatim, so nobody
// can quietly add a tenant table here and open a leak.
export const EXEMPT_MODELS = ["Plan", "SharedIntelligenceEntry"] as const;
const exempt = new Set<string>(EXEMPT_MODELS);

// `scopedPrisma` is `basePrisma` wrapped so every operation is tenant-aware.
// getScopedPrisma() (index.ts) hands this to the rest of the app.
export const scopedPrisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // Exempt (global) models run untouched.
        if (model && exempt.has(model)) return query(args);
        // Every other model REQUIRES context. No context → throw, never leak.
        const ctx = getContext();
        if (!ctx) throw new MissingContextError();
        const tenantId = ctx.tenantId;
        const a = (args ?? {}) as Record<string, unknown>;

        // Stamp tenantId in the right place depending on the operation:
        if (operation === "create") {
          // new row → force our tenantId into the data
          a.data = { ...((a.data as object) ?? {}), tenantId };
        } else if (operation === "createMany") {
          // bulk insert → stamp every row
          const data = a.data;
          a.data = Array.isArray(data)
            ? data.map((d) => ({ ...(d as object), tenantId }))
            : { ...((data as object) ?? {}), tenantId };
        } else if (operation === "upsert") {
          // upsert touches all three: the match, the insert, and the update
          a.where = { ...((a.where as object) ?? {}), tenantId };
          a.create = { ...((a.create as object) ?? {}), tenantId };
          a.update = { ...((a.update as object) ?? {}), tenantId };
        } else {
          // reads (find*), deletes, updates → add a tenantId WHERE filter so we can
          // only ever see/touch our own rows...
          a.where = { ...((a.where as object) ?? {}), tenantId };
          // ...and for updates, also stamp the data so a caller can't reassign a row
          // to a different tenant.
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
