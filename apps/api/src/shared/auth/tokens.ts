import { randomBytes, createHash } from "node:crypto";
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex"); // 64 chars
  return { raw, hash: hashToken(raw) };
}
