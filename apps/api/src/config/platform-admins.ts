// Platform ("super support") admins live in config, NOT in any tenant's users table —
// they exist above all tenants and are how staff impersonate a tenant for support.
// Parsed once from the PLATFORM_ADMINS env JSON; passwords are stored pre-hashed (argon2id).
import { z } from "zod";
import { env } from "./env.js";

const schema = z.array(z.object({ id: z.string(), label: z.string(), passwordHash: z.string() }));
const admins = schema.parse(JSON.parse(env.PLATFORM_ADMINS));

// Look up a platform admin by id (used by the impersonation endpoint). Undefined if none.
export function findPlatformAdmin(id: string): { id: string; label: string; passwordHash: string } | undefined {
  return admins.find((a) => a.id === id);
}
