// The raw, UNSCOPED Prisma client — it sees every tenant's rows with no filtering.
// Dangerous on purpose: only a tiny sanctioned set of files may import it (the tenant
// extension that wraps it, the system-caller gate, raw SQL, and the cleanup job).
// leak-suite/base-client-boundary.test.ts enforces that boundary. Everyone else uses
// getScopedPrisma() instead. In tests it points at the throwaway TEST_DATABASE_URL.
import { PrismaClient } from "@prisma/client";
import { env, isTest } from "../../config/env.js";

export const basePrisma = new PrismaClient({
  datasources: { db: { url: isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL } },
});
