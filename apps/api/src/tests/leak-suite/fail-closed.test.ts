import { describe, it, expect } from "vitest";
import { runWithContext, getContext, requireContext, MissingContextError } from "../../shared/context/request-context.js";

describe("request context", () => {
  it("returns undefined outside a context", () => {
    expect(getContext()).toBeUndefined();
  });
  it("exposes the context inside runWithContext", () => {
    const out = runWithContext({ tenantId: "t1" }, () => getContext());
    expect(out).toEqual({ tenantId: "t1" });
  });
  it("requireContext throws MissingContextError when absent", () => {
    expect(() => requireContext()).toThrow(MissingContextError);
  });
});

import { beforeAll, afterAll } from "vitest";
import { getScopedPrisma, EXEMPT_MODELS } from "../../shared/prisma/index.js";
import { runWithContext as _rwc } from "../../shared/context/request-context.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";

describe("scoped prisma fail-closed", () => {
  beforeAll(async () => {
    await resetDb();
    await basePrisma.tenant.create({ data: { name: "T1", slug: "t1" } });
  });
  afterAll(async () => { await resetDb(); });

  it("EXEMPT_MODELS is exactly the two global models", () => {
    expect([...EXEMPT_MODELS].sort()).toEqual(["Plan", "SharedIntelligenceEntry"]);
  });
  it("throws when querying a tenant model with no context", async () => {
    await expect(getScopedPrisma().user.findMany()).rejects.toThrow(/fail-closed/i);
  });
  it("auto-scopes reads to the context tenant", async () => {
    const t1 = await basePrisma.tenant.findUniqueOrThrow({ where: { slug: "t1" } });
    await _rwc({ tenantId: t1.id }, async () => {
      await getScopedPrisma().property.create({ data: { name: "P", tenantId: t1.id } });
    });
    const seen = await _rwc({ tenantId: "does-not-exist" }, () => getScopedPrisma().property.findMany());
    expect(seen).toHaveLength(0);
  });
});
