// Opaque random tokens for refresh tokens, invites, and password resets. The pattern:
// give the RAW token to the user (cookie/email link), store only its SHA-256 HASH in the
// DB. If the database leaks, the stored hashes can't be replayed. (These are plain random
// secrets, not JWTs — they carry no claims; the DB row is the source of truth.)
import { randomBytes, createHash } from "node:crypto";
// One-way hash used both to store and to look a token up by its raw value.
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
// Make a new token: `raw` goes to the user, `hash` goes in the database.
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex"); // 64 chars
  return { raw, hash: hashToken(raw) };
}
