import { Prisma } from "@prisma/client";
import { basePrisma } from "../prisma/base-client.js";
import { requireContext } from "../context/request-context.js";

// The ONLY door to raw SQL. Asserts tenant context exists; callers must include
// tenantId in their WHERE clause explicitly (parameterized).
export async function rawQuery<T = unknown>(query: Prisma.Sql): Promise<T> {
  requireContext(); // throws fail-closed if no context
  return basePrisma.$queryRaw<T>(query);
}
