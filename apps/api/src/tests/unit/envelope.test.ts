import { describe, it, expect } from "vitest";
import { AppError } from "../../shared/errors/app-error.js";
import { toEnvelope } from "../../shared/errors/handler.js";

describe("error envelope", () => {
  it("maps AppError to { error: { code, message } } with its status", () => {
    const e = new AppError("UNAUTHORIZED", "nope", 401);
    expect(toEnvelope(e)).toEqual({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "nope" } } });
  });
  it("maps unknown errors to a 500 generic envelope", () => {
    expect(toEnvelope(new Error("boom"))).toEqual({ status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } });
  });
});
