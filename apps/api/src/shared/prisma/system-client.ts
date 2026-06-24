import { PrismaClient } from "@prisma/client";
import { basePrisma } from "./base-client.js";

// The ONLY functions permitted to query the database WITHOUT tenant context.
// Test-locked: leak-suite/system-path-lock asserts this list verbatim.
export const ALLOWED_SYSTEM_CALLERS = ["resolveTenantBySubdomain"] as const;
type SystemCaller = (typeof ALLOWED_SYSTEM_CALLERS)[number];

export async function runSystem<T>(caller: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  if (!(ALLOWED_SYSTEM_CALLERS as readonly string[]).includes(caller)) {
    throw new Error(`"${caller}" is not an allowed system caller (unscoped DB access denied).`);
  }
  return fn(basePrisma);
}
export type { SystemCaller };
