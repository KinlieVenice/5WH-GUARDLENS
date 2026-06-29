import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { seedSystemReportTypes } from "../src/modules/report-types/system-types.js";
const db = new PrismaClient();

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Hotel", slug: "acme" },
  });
  await seedSystemReportTypes(tenant.id);
  const passwordHash = await argon2.hash("password123", { type: argon2.argon2id });
  const admin = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@acme.test" } },
    update: {},
    create: { tenantId: tenant.id, email: "admin@acme.test", name: "Acme Admin", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash },
  });
  const [p1, p2] = await Promise.all([
    db.property.create({ data: { tenantId: tenant.id, name: "Acme Downtown" } }),
    db.property.create({ data: { tenantId: tenant.id, name: "Acme Airport" } }),
  ]);
  const supervisor = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "supe@acme.test" } },
    update: {},
    create: { tenantId: tenant.id, email: "supe@acme.test", name: "Acme Supervisor", role: "SUPERVISOR", status: "ACTIVE", passwordHash },
  });
  await db.userPropertyAccess.upsert({
    where: { userId_propertyId: { userId: supervisor.id, propertyId: p1.id } },
    update: {},
    create: { tenantId: tenant.id, userId: supervisor.id, propertyId: p1.id },
  });
  console.log({ tenant: tenant.slug, admin: admin.email, supervisor: supervisor.email, properties: [p1.name, p2.name] });
}
main().finally(() => db.$disconnect());
