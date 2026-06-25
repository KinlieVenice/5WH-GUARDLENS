// The one sanctioned escape hatch for queries that legitimately have NO tenant yet.
// The classic case: turning "acme.lvh.me" into a tenant id — you can't scope by tenant
// until you've looked the tenant up. Every such caller must be named in the allowlist
// below, so unscoped access is a short, auditable list rather than something any file
// can reach for.
import { PrismaClient } from "@prisma/client";
import { basePrisma } from "./base-client.js";

// The ONLY functions permitted to query the database WITHOUT tenant context.
// Test-locked: leak-suite/system-path-lock asserts this list verbatim.
export const ALLOWED_SYSTEM_CALLERS = ["resolveTenantBySubdomain"] as const;
type SystemCaller = (typeof ALLOWED_SYSTEM_CALLERS)[number];

// Run `fn` against the unscoped client, but only if `caller` is on the allowlist.
// An unknown caller throws — you cannot sneak past tenant scoping by inventing a name.
export async function runSystem<T>(caller: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  if (!(ALLOWED_SYSTEM_CALLERS as readonly string[]).includes(caller)) {
    throw new Error(`"${caller}" is not an allowed system caller (unscoped DB access denied).`);
  }
  return fn(basePrisma);
}
export type { SystemCaller };
