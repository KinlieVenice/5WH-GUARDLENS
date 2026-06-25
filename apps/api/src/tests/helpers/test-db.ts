// Per-test cleanup: truncate every table (via the unscoped client) between tests so each
// case starts from a known-empty DB. Delete order respects foreign keys.
import { basePrisma } from "../../shared/prisma/base-client.js";

export async function resetDb(): Promise<void> {
  // order respects FKs; Property/User cascade their children
  await basePrisma.refreshToken.deleteMany();
  await basePrisma.authToken.deleteMany();
  await basePrisma.session.deleteMany();
  await basePrisma.userPropertyAccess.deleteMany();
  await basePrisma.property.deleteMany();
  await basePrisma.user.deleteMany();
  await basePrisma.tenant.deleteMany();
}
