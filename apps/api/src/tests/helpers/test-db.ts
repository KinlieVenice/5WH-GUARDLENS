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
