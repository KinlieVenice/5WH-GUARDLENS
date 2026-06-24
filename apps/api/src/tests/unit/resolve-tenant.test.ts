import { describe, it, expect } from "vitest";
import { tenantSlugFromHost } from "../../middleware/resolve-tenant.js";

describe("tenantSlugFromHost", () => {
  it("extracts the subdomain label", () => {
    expect(tenantSlugFromHost("acme.lvh.me", "lvh.me")).toBe("acme");
    expect(tenantSlugFromHost("acme.lvh.me:3000", "lvh.me")).toBe("acme");
  });
  it("returns null for the bare base domain", () => {
    expect(tenantSlugFromHost("lvh.me", "lvh.me")).toBeNull();
  });
  it("returns null for unrelated hosts", () => {
    expect(tenantSlugFromHost("evil.com", "lvh.me")).toBeNull();
  });
});
