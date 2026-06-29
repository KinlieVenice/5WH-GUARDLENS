import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { SYSTEM_REPORT_TYPES, seedSystemReportTypes } from "../../modules/report-types/system-types.js";
import { formSchema } from "../../shared/report-schema.js";

let tenantId = "";
beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
});
afterAll(async () => { await resetDb(); });

describe("seedSystemReportTypes", () => {
  it("seeds six system types, each with a valid v1", async () => {
    await seedSystemReportTypes(tenantId);
    const types = await basePrisma.reportType.findMany({ where: { tenantId } });
    expect(types).toHaveLength(6);
    expect(types.every((t) => t.isSystem)).toBe(true);
    for (const t of types) {
      const versions = await basePrisma.reportTypeVersion.findMany({ where: { reportTypeId: t.id } });
      expect(versions).toHaveLength(1);
      expect(() => formSchema.parse(versions[0]!.schema)).not.toThrow();
    }
  });

  it("is idempotent — running twice yields six types, one v1 each", async () => {
    await seedSystemReportTypes(tenantId);
    await seedSystemReportTypes(tenantId);
    const types = await basePrisma.reportType.findMany({ where: { tenantId } });
    expect(types).toHaveLength(6);
    const versions = await basePrisma.reportTypeVersion.findMany({ where: { tenantId } });
    expect(versions).toHaveLength(6);
  });

  it("every constant entry has a valid field schema", () => {
    expect(SYSTEM_REPORT_TYPES).toHaveLength(6);
    for (const e of SYSTEM_REPORT_TYPES) expect(() => formSchema.parse(e.fields)).not.toThrow();
  });
});
