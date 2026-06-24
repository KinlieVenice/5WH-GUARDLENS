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
