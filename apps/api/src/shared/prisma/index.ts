// Public entry point for database access. Controllers/services import getScopedPrisma()
// from here and never touch base-client.js directly — so every app query is tenant-safe.
import { scopedPrisma, EXEMPT_MODELS } from "./tenant-extension.js";

export { EXEMPT_MODELS };

// Hand out the tenant-scoped client. Usage: `const db = getScopedPrisma();`
// then `db.user.findMany()` is automatically limited to the current tenant.
export function getScopedPrisma() {
  return scopedPrisma;
}
