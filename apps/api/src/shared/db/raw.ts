// Escape hatch for raw SQL. The scoped client can't auto-stamp tenantId onto hand-written
// SQL, so this stays fail-closed: it refuses to run without a request context, and callers
// MUST add tenantId to their WHERE clause themselves (parameterized — never string-built).
import { Prisma } from "@prisma/client";
import { basePrisma } from "../prisma/base-client.js";
import { requireContext } from "../context/request-context.js";

// The ONLY door to raw SQL. Asserts tenant context exists; callers must include
// tenantId in their WHERE clause explicitly (parameterized).
export async function rawQuery<T = unknown>(query: Prisma.Sql): Promise<T> {
  requireContext(); // throws fail-closed if no context
  return basePrisma.$queryRaw<T>(query);
}
