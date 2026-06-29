// LEAK SUITE: the raw (unscoped) base Prisma client may only be imported by sanctioned files; this asserts that boundary.
// LEAK SUITE: the raw (unscoped) base Prisma client may only be imported by sanctioned files; this asserts that boundary.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../"); // apps/api/src

// The ONLY non-test files permitted to import the unscoped base Prisma client.
// Everything else must use getScopedPrisma() (tenant-scoped) or runSystem() (allowlisted).
const SANCTIONED = new Set([
  "shared/prisma/tenant-extension.ts", // builds the scoped client
  "shared/prisma/system-client.ts",    // the runSystem allowlist path
  "shared/db/raw.ts",                  // tenant-asserting raw wrapper (Task 7)
  "jobs/token-cleanup.ts",             // cross-tenant maintenance (Task 19)
  "modules/outbox/outbox.relay.ts",    // cross-tenant relay (Stage 1.3)
  "modules/report-types/system-types.ts", // per-tenant system seed, explicit tenantId (Stage 1.4)
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "tests") walk(p, out); }
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("unscoped base-client import boundary", () => {
  it("only sanctioned kernel files import base-client (no module/middleware bypass)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (/from\s+["'][^"']*prisma\/base-client(?:\.js)?["']/.test(src) && !SANCTIONED.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
