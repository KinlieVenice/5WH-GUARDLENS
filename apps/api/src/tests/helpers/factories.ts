// Test fixtures. Uses the UNSCOPED basePrisma on purpose — it seeds rows for MULTIPLE
// tenants up front, which the scoped client (locked to one tenant) couldn't do. The leak
// suite then switches into one tenant's context and proves it can't reach the other's rows.
import { basePrisma } from "../../shared/prisma/base-client.js";

export type TenantFixture = {
  tenantId: string;
  userId: string;
  sessionId: string;
  propertyId: string;
};

async function makeTenant(slug: string): Promise<TenantFixture> {
  const t = await basePrisma.tenant.create({ data: { name: slug, slug } });
  const u = await basePrisma.user.create({
    data: { tenantId: t.id, email: `u@${slug}.test`, name: "U", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: "x" },
  });
  const p = await basePrisma.property.create({ data: { tenantId: t.id, name: "P" } });
  const b = await basePrisma.building.create({ data: { tenantId: t.id, propertyId: p.id, name: "B" } });
  const f = await basePrisma.floor.create({ data: { tenantId: t.id, buildingId: b.id, name: "F", level: 0 } });
  await basePrisma.zone.create({ data: { tenantId: t.id, propertyId: p.id, floorId: f.id, name: "Z" } });
  await basePrisma.auditLog.create({ data: { tenantId: t.id, action: "seed", entityType: "Tenant", entityId: t.id } });
  const s = await basePrisma.session.create({
    data: { tenantId: t.id, userId: u.id, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.refreshToken.create({
    data: { tenantId: t.id, sessionId: s.id, tokenHash: `${slug}-rt`, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.authToken.create({
    data: { tenantId: t.id, userId: u.id, purpose: "INVITE", tokenHash: `${slug}-at`, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.userPropertyAccess.create({ data: { tenantId: t.id, userId: u.id, propertyId: p.id } });
  return { tenantId: t.id, userId: u.id, sessionId: s.id, propertyId: p.id };
}

export async function seedTwoTenants(): Promise<{ a: TenantFixture; b: TenantFixture }> {
  const a = await makeTenant("aaa");
  const b = await makeTenant("bbb");
  return { a, b };
}
