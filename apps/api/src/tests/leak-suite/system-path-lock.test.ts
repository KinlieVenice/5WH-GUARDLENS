// LEAK SUITE: the system Prisma escape-hatch refuses to run unless the caller is on the ALLOWED_SYSTEM_CALLERS allowlist.
// LEAK SUITE: the system Prisma escape-hatch refuses to run unless the caller is on the ALLOWED_SYSTEM_CALLERS allowlist.
import { describe, it, expect } from "vitest";
import { runSystem, ALLOWED_SYSTEM_CALLERS } from "../../shared/prisma/system-client.js";

describe("system-client registry (system-path lock)", () => {
  it("allowed callers list is exactly the Stage-0 set", () => {
    expect([...ALLOWED_SYSTEM_CALLERS].sort()).toEqual(["resolveTenantBySubdomain"]);
  });
  it("rejects an unregistered caller", async () => {
    await expect(runSystem("sneakyUnscopedQuery", async () => 1)).rejects.toThrow(/not an allowed system caller/i);
  });
  it("allows a registered caller", async () => {
    const r = await runSystem("resolveTenantBySubdomain", async () => 42);
    expect(r).toBe(42);
  });
});
