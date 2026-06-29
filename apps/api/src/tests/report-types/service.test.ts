import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { runWithContext } from "../../shared/context/request-context.js";
import * as svc from "../../modules/report-types/report-types.service.js";

let tenantId = "", userId = "";
const ctx = () => ({ tenantId, userId });
const run = <T>(fn: () => Promise<T>) => runWithContext(ctx(), fn);
const fieldsV1 = [{ key: "location", label: "Location", type: "text" as const, required: true }];
const fieldsV2 = [
  { key: "location", label: "Location", type: "text" as const, required: true },
  { key: "value", label: "Value", type: "text" as const, required: false },
];

beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
  const u = await basePrisma.user.create({
    data: { tenantId: t.id, email: "a@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: "x" },
  });
  userId = u.id;
});
afterAll(async () => { await resetDb(); });

describe("report-types.service", () => {
  it("createType writes type + v1; editing creates v2 and leaves v1 intact (gate)", async () => {
    const { type, version } = await run(() => svc.createType({ key: "theft", name: "Theft", lane: "SECURITY" }, fieldsV1));
    expect(version.version).toBe(1);
    const v1Before = await basePrisma.reportTypeVersion.findUniqueOrThrow({ where: { id: version.id } });

    const v2 = await run(() => svc.addVersion(type.id, fieldsV2));
    expect(v2.version).toBe(2);

    const v1After = await basePrisma.reportTypeVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(v1After.schema).toEqual(v1Before.schema); // v1 untouched
    expect(v1After.createdAt.getTime()).toBe(v1Before.createdAt.getTime());
    const all = await basePrisma.reportTypeVersion.findMany({ where: { reportTypeId: type.id } });
    expect(all).toHaveLength(2);
  });

  it("getVersion resolves an old pinned version after a newer one exists (gate)", async () => {
    const { type } = await run(() => svc.createType({ key: "hazard", name: "Hazard", lane: "SAFETY" }, fieldsV1));
    await run(() => svc.addVersion(type.id, fieldsV2));
    const v1 = await run(() => svc.getVersion(type.id, 1));
    expect(v1.version).toBe(1);
    expect(v1.schema).toEqual(fieldsV1);
  });

  it("createType with a duplicate key throws CONFLICT (409)", async () => {
    await run(() => svc.createType({ key: "theft", name: "Theft", lane: "SECURITY" }, fieldsV1));
    await expect(run(() => svc.createType({ key: "theft", name: "Dup", lane: "SECURITY" }, fieldsV1))).rejects.toMatchObject({ status: 409 });
  });

  it("addVersion on a missing type throws NOT_FOUND (404)", async () => {
    await expect(run(() => svc.addVersion("nope", fieldsV2))).rejects.toMatchObject({ status: 404 });
  });

  it("createType rejects an invalid field schema", async () => {
    await expect(
      run(() => svc.createType({ key: "bad", name: "Bad", lane: "SECURITY" }, [{ key: "d", label: "D", type: "dropdown", required: true } as never])),
    ).rejects.toThrow(/dropdown requires options/i);
  });

  it("getType returns the type with nested versions ordered ascending", async () => {
    const { type } = await run(() => svc.createType({ key: "viz", name: "Viz", lane: "SECURITY" }, fieldsV1));
    await run(() => svc.addVersion(type.id, fieldsV2));
    const full = await run(() => svc.getType(type.id));
    expect(full.id).toBe(type.id);
    expect(full.versions).toHaveLength(2);
    expect(full.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("updateTypeMeta patches name/lane/isActive in place without a new version", async () => {
    const { type } = await run(() => svc.createType({ key: "lost", name: "Lost", lane: "SECURITY" }, fieldsV1));
    const updated = await run(() => svc.updateTypeMeta(type.id, { name: "Lost Item", isActive: false }));
    expect(updated.name).toBe("Lost Item");
    expect(updated.isActive).toBe(false);
    const versions = await basePrisma.reportTypeVersion.findMany({ where: { reportTypeId: type.id } });
    expect(versions).toHaveLength(1); // meta edit does not version
  });

  it("listTypes filters by lane and activeOnly", async () => {
    const { type: lost } = await run(() => svc.createType({ key: "lost", name: "Lost", lane: "SECURITY" }, fieldsV1));
    await run(() => svc.createType({ key: "haz", name: "Haz", lane: "SAFETY" }, fieldsV1));
    await run(() => svc.updateTypeMeta(lost.id, { isActive: false }));
    const security = await run(() => svc.listTypes({ lane: "SECURITY" }));
    expect(security.map((t) => t.key)).toEqual(["lost"]);
    const activeSecurity = await run(() => svc.listTypes({ lane: "SECURITY", activeOnly: true }));
    expect(activeSecurity).toHaveLength(0);
  });
});
