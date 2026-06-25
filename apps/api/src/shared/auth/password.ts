// Password hashing using argon2id — a memory-hard algorithm that's deliberately slow and
// resistant to GPU cracking. We only ever store the hash; the plaintext is never persisted.
import argon2 from "argon2";
// Hash a new/changed password before saving it.
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}
// Compare a login attempt against the stored hash. Returns false (never throws) on a bad
// password OR a corrupt/garbage hash, so callers get one uniform "no" either way.
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try { return await argon2.verify(hash, plain); } catch { return false; }
}
