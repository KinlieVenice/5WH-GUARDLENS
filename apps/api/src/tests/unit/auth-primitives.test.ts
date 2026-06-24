import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken, verifyAccessToken } from "../../shared/auth/jwt.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";
import { env } from "../../config/env.js";

describe("auth primitives", () => {
  it("argon2id hash verifies", async () => {
    const h = await hashPassword("s3cret");
    expect(await verifyPassword(h, "s3cret")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("access token round-trips claims", () => {
    const t = signAccessToken({ tenantId: "t", userId: "u", sessionId: "s", role: "HOTEL_ADMIN" });
    const c = verifyAccessToken(t);
    expect(c).toMatchObject({ tenantId: "t", userId: "u", sessionId: "s", role: "HOTEL_ADMIN" });
  });
  it("rejects a token missing a required claim", () => {
    const bad = jwt.sign({ userId: "u", sessionId: "s", role: "HOTEL_ADMIN" }, env.JWT_SECRET);
    expect(() => verifyAccessToken(bad)).toThrow(/missing required claims/i);
  });
  it("generateToken returns raw + matching sha256 hash", () => {
    const { raw, hash } = generateToken();
    expect(raw).toHaveLength(64);
    expect(hash).toBe(hashToken(raw));
  });
});
