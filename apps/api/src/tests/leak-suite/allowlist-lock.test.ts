import { describe, it, expect } from "vitest";
import { EXEMPT_MODELS } from "../../shared/prisma/index.js";

describe("allowlist lock", () => {
  it("exempt models are EXACTLY {Plan, SharedIntelligenceEntry}", () => {
    expect([...EXEMPT_MODELS].sort()).toEqual(["Plan", "SharedIntelligenceEntry"]);
  });
  it("no Stage-0 model is exempt", () => {
    const stage0 = ["Tenant", "User", "Session", "RefreshToken", "AuthToken", "UserPropertyAccess", "Property"];
    for (const m of stage0) expect(EXEMPT_MODELS as readonly string[]).not.toContain(m);
  });
});
