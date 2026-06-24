# Stage 0 — Foundation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant-safe backend kernel with subdomain tenant resolution, fail-closed tenant isolation, cookie+CSRF web auth (login/refresh/invite/reset), RBAC + property scope, an audited impersonation seam, and a thin React auth shell — proven by a leak suite that gates CI.

**Architecture:** A modular monolith in an npm-workspaces monorepo. `apps/api` is Express 5 + Prisma (MySQL) + Redis. Every DB read/write goes through a Prisma client extension that injects `tenantId` from an `AsyncLocalStorage` request context and **throws when context is absent** (fail-closed). The only unscoped DB access is a single named function, `resolveTenantBySubdomain`, routed through a registry-guarded system client. `apps/web` is a thin Vite/React shell that exercises the cookie/CSRF/refresh loop in a real browser.

**Tech Stack:** Node 24, TypeScript (strict), Express 5, Prisma + MySQL 8, Redis (ioredis), Zod, argon2, jsonwebtoken, Vitest + supertest, Vite + React + Tailwind. Dev infra via docker-compose. Dev subdomains via `lvh.me`.

## Global Constraints

- **Tenant isolation is fail-closed.** Any DB query with no tenant context throws; it must never run unscoped. Verbatim exempt-model allowlist: `["Plan", "SharedIntelligenceEntry"]` (neither exists in Stage 0, so *every* Stage-0 model is scoped).
- **Exactly one unscoped function** in Stage 0: `resolveTenantBySubdomain`. The system-client registry `ALLOWED_SYSTEM_CALLERS = ["resolveTenantBySubdomain"]` is verbatim and test-locked.
- **TypeScript strict**: `"strict": true`, `"noUncheckedIndexedAccess": true`. No `any` in committed code.
- **IDs are `cuid()`** (Prisma `@default(cuid())`).
- **Access token TTL = 15 minutes** (`ACCESS_TOKEN_TTL_SECONDS=900`). Refresh token TTL = 30 days. Refresh reuse grace window = **20 seconds** (`REFRESH_GRACE_SECONDS=20`).
- **Cookies:** `httpOnly`, `secure` (except in test env), `sameSite=strict`. Access + CSRF cookies scoped to the subdomain; refresh cookie additionally `path=/api/auth/refresh`.
- **Response envelope:** success `{ data, meta? }`; failure `{ error: { code, message } }`.
- **Passwords:** argon2id only. **Never** reveal whether an email exists (generic login error; `forgot-password` always 200).
- **GUARD role can never be issued a session** — hard gate in login.
- **Property scope (B8):** `HOTEL_ADMIN`/`SUPER_ADMIN` tenant-wide; `SECURITY_MANAGER`/`SUPERVISOR` limited to their `UserPropertyAccess`; a scoped role with no rows sees nothing.
- **Commit after every task.** Conventional commit messages. End each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Test DB is real MySQL** (the leak suite must exercise the real Prisma engine, not a mock).

---

## File structure (locked before tasks)

```
.
├─ docker-compose.yml                 # mysql + redis for local/dev/test
├─ package.json                       # npm workspaces root
├─ tsconfig.base.json
├─ .env.example
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ vitest.config.ts
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma             # 7 models + 4 enums
│  │  │  └─ seed.ts
│  │  └─ src/
│  │     ├─ config/
│  │     │  ├─ env.ts                 # zod-validated process env
│  │     │  └─ platform-admins.ts     # parse PLATFORM_ADMINS secret
│  │     ├─ shared/
│  │     │  ├─ context/request-context.ts
│  │     │  ├─ prisma/base-client.ts
│  │     │  ├─ prisma/system-client.ts        # unscoped + caller registry
│  │     │  ├─ prisma/tenant-extension.ts     # fail-closed scoped client
│  │     │  ├─ prisma/index.ts                # getScopedPrisma()
│  │     │  ├─ db/raw.ts                       # tenant-asserting raw wrapper
│  │     │  ├─ errors/app-error.ts
│  │     │  ├─ errors/handler.ts
│  │     │  ├─ http/envelope.ts
│  │     │  ├─ http/pagination.ts
│  │     │  ├─ validation/validate.ts
│  │     │  ├─ redis/client.ts
│  │     │  ├─ rate-limit/limiter.ts
│  │     │  └─ auth/
│  │     │     ├─ password.ts
│  │     │     ├─ jwt.ts
│  │     │     ├─ tokens.ts
│  │     │     ├─ cookies.ts
│  │     │     ├─ csrf.ts
│  │     │     ├─ rbac.ts
│  │     │     └─ property-scope.ts
│  │     ├─ middleware/
│  │     │  ├─ resolve-tenant.ts
│  │     │  ├─ authenticate.ts
│  │     │  └─ load-context.ts
│  │     ├─ modules/
│  │     │  ├─ audit/audit.ts
│  │     │  ├─ auth/auth.service.ts
│  │     │  ├─ auth/auth.controller.ts
│  │     │  ├─ auth/auth.routes.ts
│  │     │  ├─ properties/properties.controller.ts
│  │     │  ├─ properties/properties.routes.ts
│  │     │  └─ platform/platform.controller.ts
│  │     │  └─ platform/platform.routes.ts
│  │     ├─ jobs/token-cleanup.ts
│  │     ├─ app.ts                     # express app factory (middleware + routes)
│  │     ├─ server.ts                  # http entrypoint
│  │     ├─ worker.ts                  # scheduler stub + token cleanup
│  │     ├─ websocket.ts               # stub
│  │     └─ tests/
│  │        ├─ helpers/test-db.ts
│  │        ├─ helpers/factories.ts
│  │        ├─ helpers/http.ts
│  │        ├─ leak-suite/fail-closed.test.ts
│  │        ├─ leak-suite/isolation.test.ts
│  │        ├─ leak-suite/allowlist-lock.test.ts
│  │        ├─ leak-suite/system-path-lock.test.ts
│  │        ├─ leak-suite/impersonation.test.ts
│  │        ├─ auth/login.test.ts
│  │        ├─ auth/refresh.test.ts
│  │        ├─ auth/invite-reset.test.ts
│  │        ├─ auth/lockout.test.ts
│  │        ├─ authz/property-scope.test.ts
│  │        ├─ authz/csrf.test.ts
│  │        └─ integration/rate-limit.test.ts
│  └─ web/                              # Task 17 (Vite React shell)
└─ .github/workflows/ci.yml            # Task 18
```

**Key shared signatures (defined once, reused everywhere):**
- `RequestContext = { tenantId: string; userId?: string; sessionId?: string; role?: Role; impersonatedBy?: string }`
- `runWithContext<T>(ctx: RequestContext, fn: () => T): T` · `getContext(): RequestContext | undefined` · `requireContext(): RequestContext`
- `getScopedPrisma(): PrismaClient` (extension-wrapped; reads context; throws if absent)
- `runSystem<T>(caller: string, fn: (db: PrismaClient) => Promise<T>): Promise<T>` (throws unless `caller ∈ ALLOWED_SYSTEM_CALLERS`)
- `hashPassword(plain): Promise<string>` · `verifyPassword(hash, plain): Promise<boolean>`
- `signAccessToken(claims: AccessClaims): string` · `verifyAccessToken(token: string): AccessClaims` where `AccessClaims = { tenantId: string; userId: string; sessionId: string; role: Role; impersonatedBy?: string }`
- `generateToken(): { raw: string; hash: string }` · `hashToken(raw: string): string`
- `setAuthCookies(res, t: { accessToken: string; refreshToken: string; csrfToken: string }): void` · `clearAuthCookies(res): void`
- `requireRole(...roles: Role[]): RequestHandler` · `verifyCsrf: RequestHandler`
- `accessiblePropertyIds(): Promise<string[] | "ALL">`
- `audit.record(input: { action: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void>`

---

## Task 1: Monorepo scaffold, tooling, and dev infra

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.env.example`, `docker-compose.yml`, `.editorconfig`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/server.ts`, `apps/api/src/worker.ts`, `apps/api/src/websocket.ts`

**Interfaces:**
- Produces: workspace scripts; `apps/api` runnable via `tsx`; Vitest configured.

- [ ] **Step 1: Root workspace + tsconfig + env example**

`package.json`:
```json
{
  "name": "hotelsec",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "api:dev": "npm -w apps/api run dev",
    "api:test": "npm -w apps/api run test"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

`.env.example`:
```
APP_BASE_DOMAIN=lvh.me
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://root:root@localhost:3307/hotelsec
TEST_DATABASE_URL=mysql://root:root@localhost:3307/hotelsec_test
REDIS_URL=redis://localhost:6380
JWT_SECRET=dev-only-change-me-32-bytes-minimum-secret
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
REFRESH_GRACE_SECONDS=20
LOGIN_MAX_FAILURES=5
LOGIN_LOCK_SECONDS=900
# JSON array: [{ "id": "ops-1", "label": "Jane (Support)", "passwordHash": "<argon2id>" }]
PLATFORM_ADMINS=[]
```

`docker-compose.yml`:
```yaml
services:
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: hotelsec
    # host ports 3306/6379 are occupied by other projects on this machine;
    # remapped to 3307/6380 so we never touch them. Container ports unchanged.
    ports: ["3307:3306"]
    command: --default-authentication-plugin=caching_sha2_password
    volumes:
      - ./docker/mysql-init:/docker-entrypoint-initdb.d:ro
  redis:
    image: redis:7
    ports: ["6380:6379"]
```

`docker/mysql-init/01-databases.sql` (creates the separate test DB on first container init):
```sql
CREATE DATABASE IF NOT EXISTS hotelsec_test;
```

- [ ] **Step 2: API package + entrypoint stubs**

`apps/api/package.json`:
```json
{
  "name": "@hotelsec/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:migrate:test": "dotenv -e ../../.env -- prisma migrate deploy",
    "seed": "tsx prisma/seed.ts"
  },
  "prisma": { "schema": "prisma/schema.prisma" },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "argon2": "^0.41.1",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.5",
    "express": "^5.0.1",
    "helmet": "^8.0.0",
    "ioredis": "^5.4.1",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.8",
    "@types/express": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.9.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

`apps/api/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src", "prisma"] }
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    fileParallelism: false, // leak/auth tests share the test DB; run serially
    hookTimeout: 60000,
    globalSetup: ["src/tests/helpers/global-setup.ts"],
  },
});
```

`apps/api/src/tests/helpers/global-setup.ts` (applies migrations to the test DB once before the suite; from Task 3 on, the schema from Task 2 exists):
```ts
import { execSync } from "node:child_process";
import "dotenv/config";

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required to run tests");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" },
  });
}
```
(Note: `globalSetup` runs `prisma migrate deploy` against `TEST_DATABASE_URL` (the `hotelsec_test` DB created by the docker init script). Tasks 1–2 don't invoke Vitest, so the schema always exists by the time this first runs in Task 3.)

`apps/api/src/server.ts`:
```ts
console.log("api server entrypoint — wired in Task 16");
```
`apps/api/src/worker.ts`:
```ts
console.log("worker entrypoint — token cleanup wired in Task 19");
```
`apps/api/src/websocket.ts`:
```ts
console.log("websocket entrypoint — stub for Stage 2");
```

- [ ] **Step 3: Install and verify**

Run: `npm install && docker compose up -d`
Expected: install completes; `docker ps` shows mysql + redis running.
Run: `npm -w apps/api run dev` (then Ctrl-C)
Expected: prints `api server entrypoint — wired in Task 16`.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "chore: scaffold monorepo, api package, dev infra"
```

---

## Task 2: Prisma schema, migration, and seed

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`

**Interfaces:**
- Produces: models `Tenant, User, Session, RefreshToken, AuthToken, UserPropertyAccess, Property`; enums `Role, TenantStatus, UserStatus, AuthTokenPurpose`; a seeded dev tenant.

- [ ] **Step 1: Write the schema**

`apps/api/prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql"; url = env("DATABASE_URL") }

enum Role            { GUARD SUPERVISOR SECURITY_MANAGER HOTEL_ADMIN SUPER_ADMIN }
enum TenantStatus    { ACTIVE SUSPENDED CANCELED }
enum UserStatus      { INVITED ACTIVE SUSPENDED }
enum AuthTokenPurpose { INVITE PASSWORD_RESET }

model Tenant {
  id        String       @id @default(cuid())
  name      String
  slug      String       @unique
  status    TenantStatus @default(ACTIVE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  users         User[]
  sessions      Session[]
  refreshTokens RefreshToken[]
  authTokens    AuthToken[]
  properties    Property[]
}

model User {
  id           String     @id @default(cuid())
  tenantId     String
  email        String
  name         String
  passwordHash String?
  role         Role       @default(GUARD)
  status       UserStatus @default(INVITED)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  tenant         Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessions       Session[]
  propertyAccess UserPropertyAccess[]
  @@unique([tenantId, email])
  @@index([tenantId, role])
}

model Session {
  id          String    @id @default(cuid())
  tenantId    String
  userId      String
  deviceLabel String?
  userAgent   String?
  ipAddress   String?
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?
  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]
  @@index([tenantId, userId])
}

model RefreshToken {
  id           String    @id @default(cuid())
  tenantId     String
  sessionId    String
  tokenHash    String    @unique
  replacedById String?   @unique
  usedAt       DateTime?
  revokedAt    DateTime?
  expiresAt    DateTime
  createdAt    DateTime  @default(now())
  tenant     Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session    Session       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  replacedBy RefreshToken? @relation("TokenRotation", fields: [replacedById], references: [id])
  replaces   RefreshToken? @relation("TokenRotation")
  @@index([tenantId, sessionId])
}

model AuthToken {
  id        String           @id @default(cuid())
  tenantId  String
  userId    String
  purpose   AuthTokenPurpose
  tokenHash String           @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime         @default(now())
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, userId, purpose])
}

model UserPropertyAccess {
  id         String @id @default(cuid())
  tenantId   String
  userId     String
  propertyId String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  @@unique([userId, propertyId])
  @@index([tenantId, propertyId])
}

model Property {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  address   String?
  timezone  String   @default("Asia/Manila")
  createdAt DateTime @default(now())
  tenant     Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userAccess UserPropertyAccess[]
  @@index([tenantId])
}
```
(Note: `replacedById` is `@unique` and the `replaces` back-relation is one-to-one — a token is replaced by exactly one successor.)

- [ ] **Step 2: Generate client and run the first migration**

Run: `cp .env.example .env` (fill real values are fine for dev) then `npm -w apps/api run prisma:migrate -- --name init`
Expected: migration `init` created and applied; `@prisma/client` generated; tables exist in MySQL.

- [ ] **Step 3: Write the seed**

`apps/api/prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
const db = new PrismaClient();

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: { name: "Acme Hotel", slug: "acme" },
  });
  const passwordHash = await argon2.hash("password123", { type: argon2.argon2id });
  const admin = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "admin@acme.test" } },
    update: {},
    create: { tenantId: tenant.id, email: "admin@acme.test", name: "Acme Admin", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash },
  });
  const [p1, p2] = await Promise.all([
    db.property.create({ data: { tenantId: tenant.id, name: "Acme Downtown" } }),
    db.property.create({ data: { tenantId: tenant.id, name: "Acme Airport" } }),
  ]);
  const supervisor = await db.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "supe@acme.test" } },
    update: {},
    create: { tenantId: tenant.id, email: "supe@acme.test", name: "Acme Supervisor", role: "SUPERVISOR", status: "ACTIVE", passwordHash },
  });
  await db.userPropertyAccess.upsert({
    where: { userId_propertyId: { userId: supervisor.id, propertyId: p1.id } },
    update: {},
    create: { tenantId: tenant.id, userId: supervisor.id, propertyId: p1.id },
  });
  console.log({ tenant: tenant.slug, admin: admin.email, supervisor: supervisor.email, properties: [p1.name, p2.name] });
}
main().finally(() => db.$disconnect());
```

- [ ] **Step 4: Run seed**

Run: `npm -w apps/api run seed`
Expected: prints the seeded tenant/admin/supervisor/properties; no errors.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(db): add Stage 0 schema, init migration, and dev seed"
```

---

## Task 3: Request context (AsyncLocalStorage)

**Files:**
- Create: `apps/api/src/shared/context/request-context.ts`
- Test: `apps/api/src/tests/leak-suite/fail-closed.test.ts` (context portion)

**Interfaces:**
- Produces: `RequestContext`, `runWithContext`, `getContext`, `requireContext`, `MissingContextError`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/leak-suite/fail-closed.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/leak-suite/fail-closed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/shared/context/request-context.ts`:
```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@prisma/client";

export type RequestContext = {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  role?: Role;
  impersonatedBy?: string;
};

export class MissingContextError extends Error {
  constructor() {
    super("No tenant context: refusing to run an unscoped query (fail-closed).");
    this.name = "MissingContextError";
  }
}

const als = new AsyncLocalStorage<RequestContext>();
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}
export function getContext(): RequestContext | undefined {
  return als.getStore();
}
export function requireContext(): RequestContext {
  const ctx = als.getStore();
  if (!ctx) throw new MissingContextError();
  return ctx;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/leak-suite/fail-closed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(kernel): add AsyncLocalStorage request context"
```

---

## Task 4: Env config + base Prisma client + system client (registry-guarded)

**Files:**
- Create: `apps/api/src/config/env.ts`, `apps/api/src/shared/prisma/base-client.ts`, `apps/api/src/shared/prisma/system-client.ts`
- Test: `apps/api/src/tests/leak-suite/system-path-lock.test.ts`

**Interfaces:**
- Produces: `env`, `basePrisma`, `runSystem`, `ALLOWED_SYSTEM_CALLERS`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/leak-suite/system-path-lock.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/leak-suite/system-path-lock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement env, base client, system client**

`apps/api/src/config/env.ts`:
```ts
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_DOMAIN: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000),
  REFRESH_GRACE_SECONDS: z.coerce.number().default(20),
  LOGIN_MAX_FAILURES: z.coerce.number().default(5),
  LOGIN_LOCK_SECONDS: z.coerce.number().default(900),
  PLATFORM_ADMINS: z.string().default("[]"),
});
export const env = schema.parse(process.env);
export const isTest = env.NODE_ENV === "test";
```

`apps/api/src/shared/prisma/base-client.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import { env, isTest } from "../../config/env.js";

export const basePrisma = new PrismaClient({
  datasources: { db: { url: isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL } },
});
```

`apps/api/src/shared/prisma/system-client.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import { basePrisma } from "./base-client.js";

// The ONLY functions permitted to query the database WITHOUT tenant context.
// Test-locked: leak-suite/system-path-lock asserts this list verbatim.
export const ALLOWED_SYSTEM_CALLERS = ["resolveTenantBySubdomain"] as const;
type SystemCaller = (typeof ALLOWED_SYSTEM_CALLERS)[number];

export async function runSystem<T>(caller: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  if (!(ALLOWED_SYSTEM_CALLERS as readonly string[]).includes(caller)) {
    throw new Error(`"${caller}" is not an allowed system caller (unscoped DB access denied).`);
  }
  return fn(basePrisma);
}
export type { SystemCaller };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/leak-suite/system-path-lock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(kernel): env config, base prisma, registry-guarded system client"
```

---

## Task 5: Fail-closed tenant extension + scoped client

**Files:**
- Create: `apps/api/src/shared/prisma/tenant-extension.ts`, `apps/api/src/shared/prisma/index.ts`
- Create: `apps/api/src/tests/helpers/test-db.ts`
- Modify: `apps/api/src/tests/leak-suite/fail-closed.test.ts` (add scoped-client cases)

**Interfaces:**
- Consumes: `basePrisma`, `getContext`, `MissingContextError`.
- Produces: `getScopedPrisma()`, `EXEMPT_MODELS`.

- [ ] **Step 1: Write the test DB helper**

`apps/api/src/tests/helpers/test-db.ts`:
```ts
import { basePrisma } from "../../shared/prisma/base-client.js";

export async function resetDb(): Promise<void> {
  // order respects FKs; Property/User cascade their children
  await basePrisma.refreshToken.deleteMany();
  await basePrisma.authToken.deleteMany();
  await basePrisma.session.deleteMany();
  await basePrisma.userPropertyAccess.deleteMany();
  await basePrisma.property.deleteMany();
  await basePrisma.user.deleteMany();
  await basePrisma.tenant.deleteMany();
}
```

- [ ] **Step 2: Write the failing test**

Append to `apps/api/src/tests/leak-suite/fail-closed.test.ts`:
```ts
import { beforeAll, afterAll } from "vitest";
import { getScopedPrisma, EXEMPT_MODELS } from "../../shared/prisma/index.js";
import { runWithContext as _rwc } from "../../shared/context/request-context.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";

describe("scoped prisma fail-closed", () => {
  beforeAll(async () => {
    await resetDb();
    await basePrisma.tenant.create({ data: { name: "T1", slug: "t1" } });
  });
  afterAll(async () => { await resetDb(); });

  it("EXEMPT_MODELS is exactly the two global models", () => {
    expect([...EXEMPT_MODELS].sort()).toEqual(["Plan", "SharedIntelligenceEntry"]);
  });
  it("throws when querying a tenant model with no context", async () => {
    await expect(getScopedPrisma().user.findMany()).rejects.toThrow(/fail-closed/i);
  });
  it("auto-scopes reads to the context tenant", async () => {
    const t1 = await basePrisma.tenant.findUniqueOrThrow({ where: { slug: "t1" } });
    await _rwc({ tenantId: t1.id }, async () => {
      await getScopedPrisma().property.create({ data: { name: "P", tenantId: t1.id } });
    });
    const seen = await _rwc({ tenantId: "does-not-exist" }, () => getScopedPrisma().property.findMany());
    expect(seen).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/leak-suite/fail-closed.test.ts`
Expected: FAIL — `getScopedPrisma` not found.

- [ ] **Step 4: Implement the extension**

`apps/api/src/shared/prisma/tenant-extension.ts`:
```ts
import { basePrisma } from "./base-client.js";
import { getContext, MissingContextError } from "../../context/request-context.js";

export const EXEMPT_MODELS = ["Plan", "SharedIntelligenceEntry"] as const;
const exempt = new Set<string>(EXEMPT_MODELS);

// Write ops where we must inject tenantId into `data`.
const CREATE_OPS = new Set(["create", "createMany", "upsert"]);

export const scopedPrisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (model && exempt.has(model)) return query(args);
        const ctx = getContext();
        if (!ctx) throw new MissingContextError();
        const tenantId = ctx.tenantId;
        const a = (args ?? {}) as Record<string, unknown>;

        // Reads / updates / deletes: constrain by tenantId via where.
        if (!CREATE_OPS.has(operation)) {
          a.where = { ...(a.where as object ?? {}), tenantId };
        }

        // Writes: stamp tenantId into data (and nested create on upsert).
        if (operation === "create") {
          a.data = { ...(a.data as object ?? {}), tenantId };
        } else if (operation === "createMany") {
          const data = a.data;
          a.data = Array.isArray(data)
            ? data.map((d) => ({ ...(d as object), tenantId }))
            : { ...(data as object), tenantId };
        } else if (operation === "upsert") {
          a.where = { ...(a.where as object ?? {}), tenantId };
          a.create = { ...(a.create as object ?? {}), tenantId };
        }
        return query(a);
      },
    },
  },
});

export type ScopedPrisma = typeof scopedPrisma;
```
(Note: import path is `../../context/...` — `tenant-extension.ts` is in `shared/prisma/`, context is in `shared/context/`, so `../context/request-context.js`. **Use `../context/request-context.js`.** Correct the import to `"../context/request-context.js"`.)

Corrected import line in `tenant-extension.ts`:
```ts
import { getContext, MissingContextError } from "../context/request-context.js";
```

`apps/api/src/shared/prisma/index.ts`:
```ts
import { scopedPrisma, EXEMPT_MODELS } from "./tenant-extension.js";
export { EXEMPT_MODELS };
export function getScopedPrisma() {
  return scopedPrisma;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/leak-suite/fail-closed.test.ts`
Expected: PASS (all context + scoped cases).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(kernel): fail-closed tenant Prisma extension + scoped client"
```

---

## Task 6: Allowlist lock + the parametrized isolation leak suite

**Files:**
- Create: `apps/api/src/tests/helpers/factories.ts`
- Create: `apps/api/src/tests/leak-suite/allowlist-lock.test.ts`
- Create: `apps/api/src/tests/leak-suite/isolation.test.ts`

**Interfaces:**
- Consumes: `getScopedPrisma`, `runWithContext`, `basePrisma`, `EXEMPT_MODELS`.
- Produces: `seedTwoTenants()` returning two tenant ids each owning one row per model.

- [ ] **Step 1: Write the two-tenant factory**

`apps/api/src/tests/helpers/factories.ts`:
```ts
import { basePrisma } from "../../shared/prisma/base-client.js";

export type TenantFixture = {
  tenantId: string;
  userId: string;
  sessionId: string;
  propertyId: string;
};

async function makeTenant(slug: string): Promise<TenantFixture> {
  const t = await basePrisma.tenant.create({ data: { name: slug, slug } });
  const u = await basePrisma.user.create({
    data: { tenantId: t.id, email: `u@${slug}.test`, name: "U", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: "x" },
  });
  const p = await basePrisma.property.create({ data: { tenantId: t.id, name: "P" } });
  const s = await basePrisma.session.create({
    data: { tenantId: t.id, userId: u.id, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.refreshToken.create({
    data: { tenantId: t.id, sessionId: s.id, tokenHash: `${slug}-rt`, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.authToken.create({
    data: { tenantId: t.id, userId: u.id, purpose: "INVITE", tokenHash: `${slug}-at`, expiresAt: new Date(Date.now() + 3.6e6) },
  });
  await basePrisma.userPropertyAccess.create({ data: { tenantId: t.id, userId: u.id, propertyId: p.id } });
  return { tenantId: t.id, userId: u.id, sessionId: s.id, propertyId: p.id };
}

export async function seedTwoTenants(): Promise<{ a: TenantFixture; b: TenantFixture }> {
  const a = await makeTenant("aaa");
  const b = await makeTenant("bbb");
  return { a, b };
}
```

- [ ] **Step 2: Write the allowlist-lock test**

`apps/api/src/tests/leak-suite/allowlist-lock.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EXEMPT_MODELS } from "../../shared/prisma/index.js";

describe("allowlist lock", () => {
  it("exempt models are EXACTLY {Plan, SharedIntelligenceEntry}", () => {
    expect([...EXEMPT_MODELS].sort()).toEqual(["Plan", "SharedIntelligenceEntry"]);
  });
  it("no Stage-0 model is exempt", () => {
    const stage0 = ["Tenant", "User", "Session", "RefreshToken", "AuthToken", "UserPropertyAccess", "Property"];
    for (const m of stage0) expect(EXEMPT_MODELS as readonly string[]).not.toContain(m);
  });
});
```

- [ ] **Step 3: Write the parametrized isolation test**

`apps/api/src/tests/leak-suite/isolation.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { runWithContext } from "../../shared/context/request-context.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { seedTwoTenants, type TenantFixture } from "../helpers/factories.js";

// Reseed before EVERY test: destructive ops (delete/cascade) must not leak
// state between cases. Factories use passwordHash:"x" (no argon) so this is cheap.
const READ_MODELS = ["user", "session", "refreshToken", "authToken", "userPropertyAccess", "property"] as const;
let A: TenantFixture, B: TenantFixture;
beforeEach(async () => { await resetDb(); const r = await seedTwoTenants(); A = r.a; B = r.b; });
afterAll(async () => { await resetDb(); });

describe("read isolation — every model, A never sees B", () => {
  for (const m of READ_MODELS) {
    it(`findMany/${m} returns only A's rows`, async () => {
      const rows = await runWithContext({ tenantId: A.tenantId }, () => (getScopedPrisma() as any)[m].findMany());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: { tenantId: string }) => r.tenantId === A.tenantId)).toBe(true);
    });
    it(`count/${m} excludes B (all=2, scoped=1)`, async () => {
      const all = await (basePrisma as any)[m].count();
      const scoped = await runWithContext({ tenantId: A.tenantId }, () => (getScopedPrisma() as any)[m].count());
      expect(all).toBe(2);
      expect(scoped).toBe(1);
    });
  }
});

// Property is cascade-safe (no child rows that would break sibling assertions),
// so it carries the per-write-op isolation checks — one for every risky op.
describe("write/aggregate isolation on Property (covers every risky op)", () => {
  it("create stamps the context tenant and OVERRIDES a caller-supplied foreign tenantId", async () => {
    const created = await runWithContext({ tenantId: A.tenantId }, () =>
      getScopedPrisma().property.create({ data: { name: "X", tenantId: B.tenantId } }), // attacker passes B
    );
    expect(created.tenantId).toBe(A.tenantId); // extension forces A, not B
  });
  it("createMany maps tenantId onto every row", async () => {
    await runWithContext({ tenantId: A.tenantId }, () =>
      getScopedPrisma().property.createMany({ data: [{ name: "a", tenantId: A.tenantId }, { name: "b", tenantId: A.tenantId }] }),
    );
    const aCount = await runWithContext({ tenantId: A.tenantId }, () => getScopedPrisma().property.count());
    const bCount = await runWithContext({ tenantId: B.tenantId }, () => getScopedPrisma().property.count());
    expect(aCount).toBe(3); // 1 seeded + 2
    expect(bCount).toBe(1);
  });
  it("updateMany cannot touch B", async () => {
    const r = await runWithContext({ tenantId: A.tenantId }, () => getScopedPrisma().property.updateMany({ data: { name: "renamed" } }));
    expect(r.count).toBe(1);
    const bProp = await basePrisma.property.findFirstOrThrow({ where: { tenantId: B.tenantId } });
    expect(bProp.name).toBe("P");
  });
  it("update by id cannot cross tenants", async () => {
    const bProp = await basePrisma.property.findFirstOrThrow({ where: { tenantId: B.tenantId } });
    await expect(
      runWithContext({ tenantId: A.tenantId }, () => getScopedPrisma().property.update({ where: { id: bProp.id }, data: { name: "hax" } })),
    ).rejects.toThrow();
  });
  it("deleteMany cannot delete B", async () => {
    await runWithContext({ tenantId: A.tenantId }, () => getScopedPrisma().property.deleteMany());
    const bCount = await runWithContext({ tenantId: B.tenantId }, () => getScopedPrisma().property.count());
    expect(bCount).toBe(1);
  });
  it("upsert stamps the context tenant", async () => {
    const created = await runWithContext({ tenantId: A.tenantId }, () =>
      getScopedPrisma().property.upsert({ where: { id: "nonexistent" }, create: { name: "u", tenantId: A.tenantId }, update: { name: "u2" } }),
    );
    expect(created.tenantId).toBe(A.tenantId);
  });
  it("aggregate/groupBy stay within A", async () => {
    const grouped = await runWithContext({ tenantId: A.tenantId }, () =>
      getScopedPrisma().property.groupBy({ by: ["tenantId"], _count: true }),
    );
    expect(grouped.every((g) => g.tenantId === A.tenantId)).toBe(true);
  });
});
```
(Raw-SQL isolation is enforced by the `rawQuery` wrapper in Task 7, which calls `requireContext()`; it is not exercised here.)

(Note: `beforeEach` reseed makes every case independent, so cascade deletes can't corrupt sibling tests. The foreign-`tenantId` override case is the strongest isolation guarantee — it proves a buggy/malicious caller can't write into another tenant even by passing its id explicitly.)

- [ ] **Step 4: Run to verify they pass**

Run: `npm -w apps/api run test -- src/tests/leak-suite/allowlist-lock.test.ts src/tests/leak-suite/isolation.test.ts`
Expected: PASS — allowlist locked; every model isolates A from B.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "test(leak): allowlist lock + parametrized tenant-isolation suite"
```

---

## Task 7: Errors, response envelope, validation, raw wrapper

**Files:**
- Create: `apps/api/src/shared/errors/app-error.ts`, `apps/api/src/shared/errors/handler.ts`
- Create: `apps/api/src/shared/http/envelope.ts`, `apps/api/src/shared/http/pagination.ts`
- Create: `apps/api/src/shared/validation/validate.ts`
- Create: `apps/api/src/shared/db/raw.ts`
- Test: `apps/api/src/tests/authz/csrf.test.ts` is later; here add `apps/api/src/tests/unit/envelope.test.ts`

**Interfaces:**
- Produces: `AppError`, `errorHandler`, `ok`, `fail`, `validate`, `rawQuery`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/unit/envelope.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/unit/envelope.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/shared/errors/app-error.ts`:
```ts
export type ErrorCode =
  | "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND"
  | "CONFLICT" | "RATE_LIMITED" | "INTERNAL";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) {
    super(message);
    this.name = "AppError";
  }
}
```

`apps/api/src/shared/errors/handler.ts`:
```ts
import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error.js";

export function toEnvelope(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  return { status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toEnvelope(err);
  if (status >= 500) console.error(err);
  res.status(status).json(body);
};
```

`apps/api/src/shared/http/envelope.ts`:
```ts
import type { Response } from "express";
export function ok<T>(res: Response, data: T, meta?: unknown): void {
  res.json(meta === undefined ? { data } : { data, meta });
}
export function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}
```

`apps/api/src/shared/http/pagination.ts`:
```ts
import { z } from "zod";
export const cursorPageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type CursorPage = z.infer<typeof cursorPageSchema>;
```

`apps/api/src/shared/validation/validate.ts`:
```ts
import type { RequestHandler } from "express";
import { z, ZodTypeAny } from "zod";
import { AppError } from "../errors/app-error.js";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  const strict = schema instanceof z.ZodObject ? schema.strict() : schema;
  return (req, _res, next) => {
    const r = strict.safeParse(req.body);
    if (!r.success) return next(new AppError("BAD_REQUEST", r.error.issues[0]?.message ?? "Invalid body", 400));
    req.body = r.data;
    next();
  };
}
```

`apps/api/src/shared/db/raw.ts`:
```ts
import { Prisma } from "@prisma/client";
import { basePrisma } from "../prisma/base-client.js";
import { requireContext } from "../context/request-context.js";

// The ONLY door to raw SQL. Asserts tenant context exists; callers must include
// tenantId in their WHERE clause explicitly (parameterized).
export async function rawQuery<T = unknown>(query: Prisma.Sql): Promise<T> {
  requireContext(); // throws fail-closed if no context
  return basePrisma.$queryRaw<T>(query);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/unit/envelope.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(kernel): errors, response envelope, zod validation, raw-query wrapper"
```

---

## Task 8: Auth primitives — password, JWT, tokens, cookies

**Files:**
- Create: `apps/api/src/shared/auth/password.ts`, `jwt.ts`, `tokens.ts`, `cookies.ts`
- Test: `apps/api/src/tests/unit/auth-primitives.test.ts`

**Interfaces:**
- Produces: `hashPassword`, `verifyPassword`, `AccessClaims`, `signAccessToken`, `verifyAccessToken`, `generateToken`, `hashToken`, `setAuthCookies`, `clearAuthCookies`, cookie name constants.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/unit/auth-primitives.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken, verifyAccessToken } from "../../shared/auth/jwt.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";

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
  it("generateToken returns raw + matching sha256 hash", () => {
    const { raw, hash } = generateToken();
    expect(raw).toHaveLength(64);
    expect(hash).toBe(hashToken(raw));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/unit/auth-primitives.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/shared/auth/password.ts`:
```ts
import argon2 from "argon2";
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try { return await argon2.verify(hash, plain); } catch { return false; }
}
```

`apps/api/src/shared/auth/jwt.ts`:
```ts
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../../config/env.js";

export type AccessClaims = {
  tenantId: string; userId: string; sessionId: string; role: Role; impersonatedBy?: string;
};
export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
}
export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return {
    tenantId: String(decoded.tenantId), userId: String(decoded.userId),
    sessionId: String(decoded.sessionId), role: decoded.role as Role,
    impersonatedBy: decoded.impersonatedBy ? String(decoded.impersonatedBy) : undefined,
  };
}
```

`apps/api/src/shared/auth/tokens.ts`:
```ts
import { randomBytes, createHash } from "node:crypto";
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex"); // 64 chars
  return { raw, hash: hashToken(raw) };
}
```

`apps/api/src/shared/auth/cookies.ts`:
```ts
import type { Response } from "express";
import { isTest } from "../../config/env.js";

export const ACCESS_COOKIE = "hs_at";
export const REFRESH_COOKIE = "hs_rt";
export const CSRF_COOKIE = "hs_csrf";
const REFRESH_PATH = "/api/auth/refresh";

const base = { httpOnly: true, secure: !isTest, sameSite: "strict" as const };

export function setAuthCookies(res: Response, t: { accessToken: string; refreshToken: string; csrfToken: string }): void {
  res.cookie(ACCESS_COOKIE, t.accessToken, { ...base });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { ...base, path: REFRESH_PATH });
  res.cookie(CSRF_COOKIE, t.csrfToken, { httpOnly: false, secure: !isTest, sameSite: "strict" });
}
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/unit/auth-primitives.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(auth): password, jwt, token, and cookie primitives"
```

---

## Task 9: Middleware chain — resolveTenant, authenticate, loadContext, CSRF

**Files:**
- Create: `apps/api/src/middleware/resolve-tenant.ts`, `authenticate.ts`, `load-context.ts`
- Create: `apps/api/src/shared/auth/csrf.ts`
- Test: `apps/api/src/tests/unit/resolve-tenant.test.ts`

**Interfaces:**
- Consumes: `runSystem`, `basePrisma`, `verifyAccessToken`, `runWithContext`, `ACCESS_COOKIE`, `CSRF_COOKIE`.
- Produces: `resolveTenant`, `authenticate`, `loadContext`, `verifyCsrf`; `res.locals.tenant`, `res.locals.claims`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/unit/resolve-tenant.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tenantSlugFromHost } from "../../middleware/resolve-tenant.js";

describe("tenantSlugFromHost", () => {
  it("extracts the subdomain label", () => {
    expect(tenantSlugFromHost("acme.lvh.me", "lvh.me")).toBe("acme");
    expect(tenantSlugFromHost("acme.lvh.me:3000", "lvh.me")).toBe("acme");
  });
  it("returns null for the bare base domain", () => {
    expect(tenantSlugFromHost("lvh.me", "lvh.me")).toBeNull();
  });
  it("returns null for unrelated hosts", () => {
    expect(tenantSlugFromHost("evil.com", "lvh.me")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/unit/resolve-tenant.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the middleware**

`apps/api/src/middleware/resolve-tenant.ts`:
```ts
import type { RequestHandler } from "express";
import { runSystem } from "../shared/prisma/system-client.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors/app-error.js";

export function tenantSlugFromHost(host: string, baseDomain: string): string | null {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (h === baseDomain) return null;
  const suffix = `.${baseDomain}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  return label.includes(".") || label.length === 0 ? null : label;
}

export const resolveTenant: RequestHandler = async (req, res, next) => {
  try {
    const slug = tenantSlugFromHost(req.headers.host ?? "", env.APP_BASE_DOMAIN);
    if (!slug) return next(new AppError("NOT_FOUND", "Unknown tenant host", 404));
    const tenant = await runSystem("resolveTenantBySubdomain", (db) =>
      db.tenant.findUnique({ where: { slug }, select: { id: true, status: true } }),
    );
    if (!tenant) return next(new AppError("NOT_FOUND", "Unknown tenant", 404));
    if (tenant.status !== "ACTIVE") return next(new AppError("FORBIDDEN", "Tenant is not active", 403));
    res.locals.tenant = { id: tenant.id };
    next();
  } catch (e) { next(e); }
};
```

`apps/api/src/middleware/authenticate.ts`:
```ts
import type { RequestHandler } from "express";
import { verifyAccessToken } from "../shared/auth/jwt.js";
import { ACCESS_COOKIE } from "../shared/auth/cookies.js";
import { AppError } from "../shared/errors/app-error.js";

// Use on routes that require a logged-in user. Pre-auth routes (login/refresh/
// forgot/redeem) do NOT use this.
export const authenticate: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next(new AppError("UNAUTHORIZED", "Not authenticated", 401));
  try {
    const claims = verifyAccessToken(token);
    if (claims.tenantId !== res.locals.tenant.id) {
      return next(new AppError("UNAUTHORIZED", "Token/tenant mismatch", 401));
    }
    res.locals.claims = claims;
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired token", 401));
  }
};
```

`apps/api/src/middleware/load-context.ts`:
```ts
import type { RequestHandler } from "express";
import { runWithContext, type RequestContext } from "../shared/context/request-context.js";

// Wraps the remainder of the chain in the AsyncLocalStorage context so the
// scoped Prisma client and audit logger read it automatically.
export const loadContext: RequestHandler = (_req, res, next) => {
  const claims = res.locals.claims;
  const ctx: RequestContext = {
    tenantId: res.locals.tenant.id,
    userId: claims?.userId,
    sessionId: claims?.sessionId,
    role: claims?.role,
    impersonatedBy: claims?.impersonatedBy,
  };
  runWithContext(ctx, () => next());
};
```

`apps/api/src/shared/auth/csrf.ts`:
```ts
import type { RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { CSRF_COOKIE } from "./cookies.js";
import { AppError } from "../errors/app-error.js";

export function issueCsrf(): string {
  return randomBytes(24).toString("hex");
}
// Double-submit check for state-changing authenticated routes.
export const verifyCsrf: RequestHandler = (req, _res, next) => {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");
  if (!cookie || !header || cookie !== header) {
    return next(new AppError("FORBIDDEN", "CSRF check failed", 403));
  }
  next();
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/unit/resolve-tenant.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(kernel): resolveTenant/authenticate/loadContext middleware + CSRF"
```

---

## Task 10: Rate limiter + login lockout (Redis)

**Files:**
- Create: `apps/api/src/shared/redis/client.ts`, `apps/api/src/shared/rate-limit/limiter.ts`
- Test: `apps/api/src/tests/integration/rate-limit.test.ts`

**Interfaces:**
- Produces: `redis`, `rateLimit(opts)`, `recordFailure(key)`, `failureCount(key)`, `clearFailures(key)`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/integration/rate-limit.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { redis } from "../../shared/redis/client.js";
import { rateLimit, recordFailure, failureCount, clearFailures } from "../../shared/rate-limit/limiter.js";

describe("redis rate limiter (shared across instances)", () => {
  beforeEach(async () => { await redis.flushdb(); });
  afterAll(async () => { await redis.quit(); });

  it("two independent limiter instances share the same counter", async () => {
    const a = rateLimit({ keyPrefix: "t", limit: 3, windowSeconds: 60 });
    const b = rateLimit({ keyPrefix: "t", limit: 3, windowSeconds: 60 });
    expect(await a.consume("ip1")).toBe(true);
    expect(await a.consume("ip1")).toBe(true);
    expect(await b.consume("ip1")).toBe(true);   // 3rd, across "instance" b
    expect(await b.consume("ip1")).toBe(false);  // 4th — blocked
  });

  it("records and clears login failures", async () => {
    await recordFailure("u@x");
    await recordFailure("u@x");
    expect(await failureCount("u@x")).toBe(2);
    await clearFailures("u@x");
    expect(await failureCount("u@x")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/integration/rate-limit.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/shared/redis/client.ts`:
```ts
import Redis from "ioredis";
import { env } from "../../config/env.js";
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
```

`apps/api/src/shared/rate-limit/limiter.ts`:
```ts
import { redis } from "../redis/client.js";
import { env } from "../../config/env.js";

export function rateLimit(opts: { keyPrefix: string; limit: number; windowSeconds: number }) {
  return {
    async consume(id: string): Promise<boolean> {
      const key = `rl:${opts.keyPrefix}:${id}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, opts.windowSeconds);
      return n <= opts.limit;
    },
  };
}

const failKey = (id: string) => `login:fail:${id}`;
export async function recordFailure(id: string): Promise<void> {
  const key = failKey(id);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, env.LOGIN_LOCK_SECONDS);
}
export async function failureCount(id: string): Promise<number> {
  return Number((await redis.get(failKey(id))) ?? 0);
}
export async function clearFailures(id: string): Promise<void> {
  await redis.del(failKey(id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/integration/rate-limit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(kernel): redis rate limiter + login lockout counters"
```

---

## Task 11: Audit logger + RBAC + property scope

**Files:**
- Create: `apps/api/src/modules/audit/audit.ts`, `apps/api/src/shared/auth/rbac.ts`, `apps/api/src/shared/auth/property-scope.ts`
- Test: `apps/api/src/tests/authz/property-scope.test.ts`

**Interfaces:**
- Consumes: `requireContext`, `getScopedPrisma`.
- Produces: `audit.record`, `requireRole`, `accessiblePropertyIds`.

> Note: `audit.record` writes to an `AuditLog` table that is built in Stage 1. For Stage 0 the logger writes a structured log line and stamps `impersonatedBy` from context; the DB write is a TODO marker resolved in Stage 1.2. This keeps the *call sites* (login, refresh-revoke, impersonate) correct now. **This is intentional, not a placeholder** — there is no `AuditLog` model in Stage 0 by design.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/authz/property-scope.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithContext } from "../../shared/context/request-context.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";

let tenantId = "", p1 = "", p2 = "", supeId = "";
beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
  tenantId = t.id;
  const pa = await basePrisma.property.create({ data: { tenantId, name: "P1" } });
  const pb = await basePrisma.property.create({ data: { tenantId, name: "P2" } });
  p1 = pa.id; p2 = pb.id;
  const supe = await basePrisma.user.create({ data: { tenantId, email: "s@t", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: "x" } });
  supeId = supe.id;
  await basePrisma.userPropertyAccess.create({ data: { tenantId, userId: supeId, propertyId: p1 } });
});
afterAll(async () => { await resetDb(); });

describe("property scope (B8)", () => {
  it("admin is tenant-wide (ALL)", async () => {
    const r = await runWithContext({ tenantId, userId: "x", role: "HOTEL_ADMIN" }, () => accessiblePropertyIds());
    expect(r).toBe("ALL");
  });
  it("supervisor sees only assigned properties", async () => {
    const r = await runWithContext({ tenantId, userId: supeId, role: "SUPERVISOR" }, () => accessiblePropertyIds());
    expect(r).toEqual([p1]);
  });
  it("supervisor with no access rows sees nothing", async () => {
    const r = await runWithContext({ tenantId, userId: "nobody", role: "SUPERVISOR" }, () => accessiblePropertyIds());
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/authz/property-scope.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/shared/auth/property-scope.ts`:
```ts
import { requireContext } from "../context/request-context.js";
import { getScopedPrisma } from "../prisma/index.js";

const TENANT_WIDE = new Set(["HOTEL_ADMIN", "SUPER_ADMIN"]);

export async function accessiblePropertyIds(): Promise<string[] | "ALL"> {
  const ctx = requireContext();
  if (ctx.role && TENANT_WIDE.has(ctx.role)) return "ALL";
  if (!ctx.userId) return [];
  const rows = await getScopedPrisma().userPropertyAccess.findMany({
    where: { userId: ctx.userId }, select: { propertyId: true },
  });
  return rows.map((r) => r.propertyId);
}
```

`apps/api/src/shared/auth/rbac.ts`:
```ts
import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { AppError } from "../errors/app-error.js";

export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const role = res.locals.claims?.role as Role | undefined;
    if (!role || !roles.includes(role)) return next(new AppError("FORBIDDEN", "Insufficient role", 403));
    next();
  };
}
```

`apps/api/src/modules/audit/audit.ts`:
```ts
import { getContext } from "../../shared/context/request-context.js";

// Stage 0: structured-log audit. The AuditLog DB write lands in Stage 1.2.
// Stamps impersonatedBy from context so the impersonation seam is auditable now.
export const audit = {
  async record(input: { action: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    const ctx = getContext();
    console.info("[audit]", JSON.stringify({
      ...input,
      tenantId: ctx?.tenantId, actorUserId: ctx?.userId, impersonatedBy: ctx?.impersonatedBy, at: new Date().toISOString(),
    }));
  },
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/authz/property-scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(authz): rbac, property-scope (B8), audit logger seam"
```

---

## Task 12: Auth service + login flow

**Files:**
- Create: `apps/api/src/modules/auth/auth.service.ts`, `auth.controller.ts`, `auth.routes.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/tests/helpers/http.ts`
- Test: `apps/api/src/tests/auth/login.test.ts`, `apps/api/src/tests/auth/lockout.test.ts`

**Interfaces:**
- Consumes: all prior auth primitives, middleware, scoped prisma.
- Produces: `createApp()`; `POST /api/auth/login`; `authService.login(...)`; `issueSession(...)`.

- [ ] **Step 1: Write the http test helper**

`apps/api/src/tests/helpers/http.ts`:
```ts
import supertest from "supertest";
import { createApp } from "../../app.js";

export function client() {
  return supertest(createApp());
}
// Helper to set the tenant Host header consistently.
export const HOST = "acme.lvh.me";
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/tests/auth/login.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "guard@acme.test", name: "G", role: "GUARD", status: "ACTIVE", passwordHash: pw } });
});
afterAll(async () => { await resetDb(); });

describe("POST /api/auth/login", () => {
  it("logs in an admin and sets auth cookies", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" });
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("hs_at="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("hs_rt="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("hs_csrf="))).toBe(true);
  });
  it("rejects a GUARD (guards never get a session)", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "guard@acme.test", password: "password123" });
    expect(res.status).toBe(401);
  });
  it("rejects wrong password with a generic error", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).not.toMatch(/exist|found|password/i);
  });
  it("404s on an unknown tenant host", async () => {
    const res = await client().post("/api/auth/login").set("Host", "ghost.lvh.me").send({ email: "x@y.z", password: "p" });
    expect(res.status).toBe(404);
  });
});
```

`apps/api/src/tests/auth/lockout.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { redis } from "../../shared/redis/client.js";

beforeAll(async () => {
  await resetDb(); await redis.flushdb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "a@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: await hashPassword("password123") } });
});
afterAll(async () => { await resetDb(); await redis.quit(); });

describe("login lockout", () => {
  it("locks the account after LOGIN_MAX_FAILURES bad attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "wrong" });
    }
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "password123" });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm -w apps/api run test -- src/tests/auth/login.test.ts`
Expected: FAIL — `createApp` / routes not found.

- [ ] **Step 4: Implement service, controller, routes, app**

`apps/api/src/modules/auth/auth.service.ts`:
```ts
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { generateToken } from "../../shared/auth/tokens.js";
import { issueCsrf } from "../../shared/auth/csrf.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordFailure, failureCount, clearFailures } from "../../shared/rate-limit/limiter.js";
import type { Role } from "@prisma/client";

export type IssuedTokens = { accessToken: string; refreshToken: string; csrfToken: string };

// Creates a Session + first RefreshToken, returns cookie token bundle.
export async function issueSession(input: { userId: string; role: Role; tenantId: string; userAgent?: string; ip?: string }): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const session = await db.session.create({
    data: { tenantId: input.tenantId, userId: input.userId, userAgent: input.userAgent, ipAddress: input.ip,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
  });
  const rt = generateToken();
  await db.refreshToken.create({
    data: { tenantId: input.tenantId, sessionId: session.id, tokenHash: rt.hash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
  });
  const accessToken = signAccessToken({ tenantId: input.tenantId, userId: input.userId, sessionId: session.id, role: input.role });
  return { accessToken, refreshToken: rt.raw, csrfToken: issueCsrf() };
}

export async function login(input: { tenantId: string; email: string; password: string; userAgent?: string; ip?: string }): Promise<IssuedTokens> {
  const lockKey = `${input.tenantId}:${input.email}`;
  if ((await failureCount(lockKey)) >= env.LOGIN_MAX_FAILURES) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
  }
  const db = getScopedPrisma();
  const user = await db.user.findFirst({ where: { email: input.email } });
  const genericFail = new AppError("UNAUTHORIZED", "Invalid credentials", 401);
  // Guards never get a session; inactive users can't log in. Same generic error.
  if (!user || user.role === "GUARD" || user.status !== "ACTIVE" || !user.passwordHash) {
    await recordFailure(lockKey); throw genericFail;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await recordFailure(lockKey); throw genericFail;
  }
  await clearFailures(lockKey);
  return issueSession({ userId: user.id, role: user.role, tenantId: input.tenantId, userAgent: input.userAgent, ip: input.ip });
}
```

`apps/api/src/modules/auth/auth.controller.ts`:
```ts
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as authService from "./auth.service.js";
import { setAuthCookies } from "../../shared/auth/cookies.js";
import { ok } from "../../shared/http/envelope.js";

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tokens = await authService.login({
      tenantId: res.locals.tenant.id, email: req.body.email, password: req.body.password,
      userAgent: req.get("user-agent") ?? undefined, ip: req.ip,
    });
    setAuthCookies(res, tokens);
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
```

`apps/api/src/modules/auth/auth.routes.ts`:
```ts
import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./auth.controller.js";

export const authRoutes = Router();
authRoutes.post("/login", validateBody(ctrl.loginSchema), ctrl.login);
```

`apps/api/src/app.ts`:
```ts
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { resolveTenant } from "./middleware/resolve-tenant.js";
import { loadContext } from "./middleware/load-context.js";
import { errorHandler } from "./shared/errors/handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.use(cookieParser());
  app.set("trust proxy", true);

  // All /api routes resolve tenant from host, then run inside request context.
  app.use("/api", resolveTenant, loadContext);
  app.use("/api/auth", authRoutes);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm -w apps/api run test -- src/tests/auth/login.test.ts src/tests/auth/lockout.test.ts`
Expected: PASS (login success/guard/wrong-pw/unknown-host + lockout).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(auth): login flow, session issuance, app factory, lockout"
```

---

## Task 13: Refresh rotation + reuse-detection + grace

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (add `refresh`), `auth.controller.ts` (add `refresh`), `auth.routes.ts` (add route)
- Test: `apps/api/src/tests/auth/refresh.test.ts`

**Interfaces:**
- Consumes: `getScopedPrisma`, `generateToken`, `hashToken`, `signAccessToken`, `issueCsrf`.
- Produces: `authService.refresh(input): Promise<IssuedTokens>`; `POST /api/auth/refresh`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/auth/refresh.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { hashToken } from "../../shared/auth/tokens.js";

function rtCookie(cookies: string[]): string {
  const c = cookies.find((x) => x.startsWith("hs_rt="))!;
  return c.split(";")[0]!; // "hs_rt=<raw>"
}
async function loginAndGetCookies() {
  const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "password123" });
  return res.headers["set-cookie"] as unknown as string[];
}

beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "a@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: await hashPassword("password123") } });
});
afterAll(async () => { await resetDb(); });

describe("POST /api/auth/refresh", () => {
  it("rotates a fresh refresh token and issues new cookies", async () => {
    const cookies = await loginAndGetCookies();
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", rtCookie(cookies)).send();
    expect(res.status).toBe(200);
    const newCookies = res.headers["set-cookie"] as unknown as string[];
    expect(newCookies.some((c) => c.startsWith("hs_rt="))).toBe(true);
  });

  it("replaying an OLD token within grace succeeds without revoking the family", async () => {
    const cookies = await loginAndGetCookies();
    const old = rtCookie(cookies);
    await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // first rotation
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // replay within grace
    expect(res.status).toBe(200);
    const session = await basePrisma.session.findFirstOrThrow();
    expect(session.revokedAt).toBeNull();
  });

  it("replaying an OLD token OUTSIDE grace revokes the whole session family", async () => {
    const cookies = await loginAndGetCookies();
    const old = rtCookie(cookies);
    await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // rotate
    // Force the used token outside the grace window:
    const raw = old.replace("hs_rt=", "");
    await basePrisma.refreshToken.update({ where: { tokenHash: hashToken(raw) }, data: { usedAt: new Date(Date.now() - 60_000) } });
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send();
    expect(res.status).toBe(401);
    const session = await basePrisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/auth/refresh.test.ts`
Expected: FAIL — `/refresh` route missing.

- [ ] **Step 3: Implement `refresh` in the service**

Append to `apps/api/src/modules/auth/auth.service.ts`:
```ts
import { hashToken } from "../../shared/auth/tokens.js";

async function rotateFrom(tokenId: string, sessionId: string, tenantId: string, role: Role, userId: string): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const next = generateToken();
  await db.$transaction(async (tx) => {
    const created = await (tx as typeof db).refreshToken.create({
      data: { tenantId, sessionId, tokenHash: next.hash, expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
    });
    await (tx as typeof db).refreshToken.update({ where: { id: tokenId }, data: { usedAt: new Date(), replacedById: created.id } });
    await (tx as typeof db).session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
  });
  const accessToken = signAccessToken({ tenantId, userId, sessionId, role });
  return { accessToken, refreshToken: next.raw, csrfToken: issueCsrf() };
}

async function revokeFamily(sessionId: string): Promise<void> {
  const db = getScopedPrisma();
  await db.$transaction([
    db.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }),
  ]);
}

export async function refresh(input: { rawToken: string }): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const token = await db.refreshToken.findFirst({
    where: { tokenHash: hashToken(input.rawToken) },
    include: { session: { include: { user: true } } },
  });
  const unauthorized = new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  if (!token) throw unauthorized;
  if (token.revokedAt || token.expiresAt < new Date()) throw unauthorized;
  const role = token.session.user.role;
  const userId = token.session.userId;

  if (!token.usedAt) {
    return rotateFrom(token.id, token.sessionId, token.tenantId, role, userId);
  }
  // Already used — benign retry within grace, else theft.
  const ageSeconds = (Date.now() - token.usedAt.getTime()) / 1000;
  const successor = token.replacedById ? await db.refreshToken.findFirst({ where: { id: token.replacedById } }) : null;
  const benign = ageSeconds <= env.REFRESH_GRACE_SECONDS && successor && !successor.usedAt && !successor.revokedAt;
  if (benign && successor) {
    return rotateFrom(successor.id, token.sessionId, token.tenantId, role, userId);
  }
  await revokeFamily(token.sessionId);
  throw unauthorized;
}
```

- [ ] **Step 4: Add the controller + route**

Append to `apps/api/src/modules/auth/auth.controller.ts`:
```ts
import { clearAuthCookies, REFRESH_COOKIE } from "../../shared/auth/cookies.js";

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) { clearAuthCookies(res); res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No refresh token" } }); return; }
    const tokens = await authService.refresh({ rawToken: raw });
    setAuthCookies(res, tokens);
    ok(res, { ok: true });
  } catch (e) {
    clearAuthCookies(res);
    next(e);
  }
}
```

Append to `apps/api/src/modules/auth/auth.routes.ts`:
```ts
authRoutes.post("/refresh", ctrl.refresh);
```
(Note: the refresh cookie is `Path=/api/auth/refresh`; the route path matches so the browser sends it.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/auth/refresh.test.ts`
Expected: PASS (rotate / grace / theft-revoke).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(auth): refresh rotation with reuse-detection and grace window"
```

---

## Task 14: Logout, whoami heartbeat, invite + password reset

**Files:**
- Modify: `auth.service.ts`, `auth.controller.ts`, `auth.routes.ts`
- Create: `apps/api/src/modules/users/users.service.ts` (invite issuance)
- Test: `apps/api/src/tests/auth/invite-reset.test.ts`

**Interfaces:**
- Produces: `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/forgot`, `POST /api/auth/redeem`; `usersService.createInvite`, `authService.redeemToken`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/auth/invite-reset.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";

let tenantId = "";
beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
});
afterAll(async () => { await resetDb(); });

async function makeInvite(email: string) {
  const u = await basePrisma.user.create({ data: { tenantId, email, name: "New", role: "SUPERVISOR", status: "INVITED" } });
  const { raw, hash } = generateToken();
  await basePrisma.authToken.create({ data: { tenantId, userId: u.id, purpose: "INVITE", tokenHash: hash, expiresAt: new Date(Date.now() + 6e8) } });
  return { userId: u.id, raw };
}

describe("invite + reset redemption", () => {
  it("redeeming an INVITE token sets a password and activates the user", async () => {
    const { userId, raw } = await makeInvite("new@acme.test");
    const res = await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "brandnewpass" });
    expect(res.status).toBe(200);
    const u = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.status).toBe("ACTIVE");
    expect(u.passwordHash).not.toBeNull();
  });
  it("a token is single-use", async () => {
    const { raw } = await makeInvite("two@acme.test");
    await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "brandnewpass" });
    const res2 = await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "another1234" });
    expect(res2.status).toBe(400);
  });
  it("forgot-password always returns 200, even for an unknown email", async () => {
    const res = await client().post("/api/auth/forgot").set("Host", HOST).send({ email: "ghost@acme.test" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/auth/invite-reset.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement service functions**

Append to `apps/api/src/modules/auth/auth.service.ts`:
```ts
import { hashPassword } from "../../shared/auth/password.js";
import type { AuthTokenPurpose } from "@prisma/client";

export async function revokeSession(sessionId: string): Promise<void> {
  await revokeFamily(sessionId);
}

export async function issueAuthToken(userId: string, tenantId: string, purpose: AuthTokenPurpose, ttlSeconds: number): Promise<string> {
  const db = getScopedPrisma();
  const { raw, hash } = generateToken();
  await db.authToken.create({ data: { tenantId, userId, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + ttlSeconds * 1000) } });
  return raw; // caller emails this; we only store the hash
}

export async function redeemToken(input: { rawToken: string; password: string }): Promise<void> {
  const db = getScopedPrisma();
  const token = await db.authToken.findFirst({ where: { tokenHash: hashToken(input.rawToken) } });
  if (!token || token.usedAt || token.expiresAt < new Date()) {
    throw new AppError("BAD_REQUEST", "Invalid or expired token", 400);
  }
  const passwordHash = await hashPassword(input.password);
  await db.$transaction([
    db.user.update({ where: { id: token.userId }, data: { passwordHash, status: "ACTIVE" } }),
    db.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function startPasswordReset(email: string, tenantId: string): Promise<void> {
  const db = getScopedPrisma();
  const user = await db.user.findFirst({ where: { email } });
  if (!user || user.role === "GUARD") return; // silently no-op; never reveal existence
  const raw = await issueAuthToken(user.id, tenantId, "PASSWORD_RESET", 3600);
  console.info("[email] password reset link token (dev):", raw); // real email adapter is Stage 2
}
```

- [ ] **Step 4: Implement controllers + routes**

Append to `apps/api/src/modules/auth/auth.controller.ts`:
```ts
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { audit } from "../audit/audit.js";

export const redeemSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });
export const forgotSchema = z.object({ email: z.string().email() });

export async function logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessionId = res.locals.claims.sessionId as string;
    await authService.revokeSession(sessionId);
    await audit.record({ action: "session.revoke", entityType: "Session", entityId: sessionId });
    clearAuthCookies(res);
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

export async function me(res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, role, tenantId, sessionId, impersonatedBy } = res.locals.claims;
    // Impersonation tokens are stateless (no Session row) and self-expire in <=15 min;
    // skip the session-revocation check for them. Normal sessions are heartbeat-checked.
    if (!impersonatedBy) {
      const session = await getScopedPrisma().session.findFirst({ where: { id: sessionId } });
      if (!session || session.revokedAt) { clearAuthCookies(res); res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Session ended" } }); return; }
    }
    ok(res, { userId, role, tenantId, impersonatedBy });
  } catch (e) { next(e); }
}

export async function forgot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await authService.startPasswordReset(req.body.email, res.locals.tenant.id); ok(res, { ok: true }); }
  catch (e) { next(e); }
}

export async function redeem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await authService.redeemToken({ rawToken: req.body.token, password: req.body.password }); ok(res, { ok: true }); }
  catch (e) { next(e); }
}
```
(Note: `me` takes `(res, next)` and is wrapped below to pass `res` only; adjust the route to `(req,res,next)=>ctrl.me(res,next)`.)

Append to `apps/api/src/modules/auth/auth.routes.ts`:
```ts
import { authenticate } from "../../middleware/authenticate.js";
import { verifyCsrf } from "../../shared/auth/csrf.js";

authRoutes.post("/forgot", validateBody(ctrl.forgotSchema), ctrl.forgot);
authRoutes.post("/redeem", validateBody(ctrl.redeemSchema), ctrl.redeem);
authRoutes.post("/logout", authenticate, verifyCsrf, ctrl.logout);
authRoutes.get("/me", authenticate, (req, res, next) => ctrl.me(res, next));
```

`apps/api/src/modules/users/users.service.ts`:
```ts
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { issueAuthToken } from "../auth/auth.service.js";
import type { Role } from "@prisma/client";

// Admin creates an invited user and gets a one-time INVITE token (to email).
export async function createInvite(input: { tenantId: string; email: string; name: string; role: Role }): Promise<{ userId: string; token: string }> {
  const db = getScopedPrisma();
  const user = await db.user.create({ data: { tenantId: input.tenantId, email: input.email, name: input.name, role: input.role, status: "INVITED" } });
  const token = await issueAuthToken(user.id, input.tenantId, "INVITE", 7 * 24 * 3600);
  return { userId: user.id, token };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/auth/invite-reset.test.ts`
Expected: PASS (redeem activates, single-use, forgot always 200).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(auth): logout, whoami heartbeat, invite + password-reset redemption"
```

---

## Task 15: Properties read endpoint (B8 surface) + CSRF integration test

**Files:**
- Create: `apps/api/src/modules/properties/properties.controller.ts`, `properties.routes.ts`
- Modify: `apps/api/src/app.ts` (mount properties)
- Test: `apps/api/src/tests/authz/csrf.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `accessiblePropertyIds`, `getScopedPrisma`, `verifyCsrf`.
- Produces: `GET /api/properties`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/authz/csrf.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";

let adminCookies: string[] = [], supeCookies: string[] = [];
function jar(cookies: string[]): string { return cookies.map((c) => c.split(";")[0]).join("; "); }
function csrfValue(cookies: string[]): string { return cookies.find((c) => c.startsWith("hs_csrf="))!.split(";")[0]!.replace("hs_csrf=", ""); }

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  const p1 = await basePrisma.property.create({ data: { tenantId: t.id, name: "P1" } });
  await basePrisma.property.create({ data: { tenantId: t.id, name: "P2" } });
  const supe = await basePrisma.user.create({ data: { tenantId: t.id, email: "supe@acme.test", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: pw } });
  await basePrisma.userPropertyAccess.create({ data: { tenantId: t.id, userId: supe.id, propertyId: p1.id } });
  adminCookies = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
  supeCookies = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "supe@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
});
afterAll(async () => { await resetDb(); });

describe("GET /api/properties (B8) + CSRF", () => {
  it("admin sees all tenant properties", async () => {
    const res = await client().get("/api/properties").set("Host", HOST).set("Cookie", jar(adminCookies));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
  it("supervisor sees only assigned properties", async () => {
    const res = await client().get("/api/properties").set("Host", HOST).set("Cookie", jar(supeCookies));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
  it("logout without CSRF header is rejected (403)", async () => {
    const res = await client().post("/api/auth/logout").set("Host", HOST).set("Cookie", jar(adminCookies));
    expect(res.status).toBe(403);
  });
  it("logout with the CSRF header succeeds", async () => {
    const res = await client().post("/api/auth/logout").set("Host", HOST).set("Cookie", jar(adminCookies)).set("x-csrf-token", csrfValue(adminCookies));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/authz/csrf.test.ts`
Expected: FAIL — `/api/properties` missing.

- [ ] **Step 3: Implement**

`apps/api/src/modules/properties/properties.controller.ts`:
```ts
import type { Request, Response, NextFunction } from "express";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { ok } from "../../shared/http/envelope.js";

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ids = await accessiblePropertyIds();
    const where = ids === "ALL" ? {} : { id: { in: ids } };
    const props = await getScopedPrisma().property.findMany({ where, orderBy: { createdAt: "asc" } });
    ok(res, props);
  } catch (e) { next(e); }
}
```

`apps/api/src/modules/properties/properties.routes.ts`:
```ts
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as ctrl from "./properties.controller.js";

export const propertyRoutes = Router();
propertyRoutes.get("/", authenticate, ctrl.list);
```

Modify `apps/api/src/app.ts` — add the import and mount after auth routes:
```ts
import { propertyRoutes } from "./modules/properties/properties.routes.js";
// ... after app.use("/api/auth", authRoutes):
app.use("/api/properties", propertyRoutes);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/authz/csrf.test.ts`
Expected: PASS (B8 admin/supervisor + CSRF reject/accept).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(properties): read endpoint enforcing property scope + CSRF coverage"
```

---

## Task 16: Platform impersonation seam (B6) + server entrypoint

**Files:**
- Create: `apps/api/src/config/platform-admins.ts`, `apps/api/src/modules/platform/platform.controller.ts`, `platform.routes.ts`
- Modify: `apps/api/src/app.ts` (mount platform routes), `apps/api/src/server.ts`
- Test: `apps/api/src/tests/leak-suite/impersonation.test.ts`

**Interfaces:**
- Consumes: env `PLATFORM_ADMINS`, `verifyPassword`, `signAccessToken`, `runSystem`.
- Produces: `POST /api/platform/impersonate`; impersonation tokens carry `impersonatedBy`.

> The impersonate endpoint must mint a token for a target tenant *without* tenant context yet (the caller is platform staff, not a tenant user). It validates the target tenant via the same single system path. Because this is a **second** unscoped need, it routes its tenant lookup through `resolveTenantBySubdomain`'s host (the request hits the target tenant's subdomain), so it adds **no** new system caller — keeping the system-path lock at exactly one.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/leak-suite/impersonation.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { verifyAccessToken } from "../../shared/auth/jwt.js";
import { ACCESS_COOKIE } from "../../shared/auth/cookies.js";

beforeAll(async () => {
  await resetDb();
  await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
});
afterAll(async () => { await resetDb(); });

describe("impersonation seam (B6)", () => {
  it("mints a tenant token stamped with impersonatedBy", async () => {
    // env PLATFORM_ADMINS for tests holds id "ops-1" with password "platformpass" (see test setup note)
    const res = await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "platformpass" });
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    const at = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!.split(";")[0]!.replace(`${ACCESS_COOKIE}=`, "");
    const claims = verifyAccessToken(decodeURIComponent(at));
    expect(claims.impersonatedBy).toBe("ops-1");
    expect(claims.role).toBe("SUPER_ADMIN");
  });
  it("rejects a bad platform credential", async () => {
    const res = await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "wrong" });
    expect(res.status).toBe(401);
  });
});
```

> **Test setup note (add to `apps/api/vitest.config.ts` `test.env`):** generate an argon2id hash of `"platformpass"` once and put `PLATFORM_ADMINS='[{"id":"ops-1","label":"Ops","passwordHash":"<hash>"}]'` into a `.env.test` loaded by the config. Add to `vitest.config.ts`: `test: { env: { NODE_ENV: "test" } }` and load `.env.test` via `dotenv` at the top of the config. Provide the hash by running `node -e "import('argon2').then(a=>a.hash('platformpass',{type:a.argon2id}).then(console.log))"` and pasting the result.

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/leak-suite/impersonation.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement platform admin config + endpoint**

`apps/api/src/config/platform-admins.ts`:
```ts
import { z } from "zod";
import { env } from "./env.js";

const schema = z.array(z.object({ id: z.string(), label: z.string(), passwordHash: z.string() }));
const admins = schema.parse(JSON.parse(env.PLATFORM_ADMINS));

export function findPlatformAdmin(id: string): { id: string; label: string; passwordHash: string } | undefined {
  return admins.find((a) => a.id === id);
}
```

`apps/api/src/modules/platform/platform.controller.ts`:
```ts
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { findPlatformAdmin } from "../../config/platform-admins.js";
import { verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { issueCsrf } from "../../shared/auth/csrf.js";
import { setAuthCookies } from "../../shared/auth/cookies.js";
import { generateToken } from "../../shared/auth/tokens.js";
import { ok } from "../../shared/http/envelope.js";
import { AppError } from "../../shared/errors/app-error.js";
import { audit } from "../audit/audit.js";

export const impersonateSchema = z.object({ platformId: z.string().min(1), password: z.string().min(1) });

// Mints a SUPER_ADMIN-level access token for the tenant on this host, stamped
// with impersonatedBy. Tenant is already resolved by resolveTenant (res.locals.tenant).
export async function impersonate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = findPlatformAdmin(req.body.platformId);
    const fail = new AppError("UNAUTHORIZED", "Invalid platform credentials", 401);
    if (!admin || !(await verifyPassword(admin.passwordHash, req.body.password))) throw fail;

    const tenantId = res.locals.tenant.id;
    const accessToken = signAccessToken({
      tenantId, userId: `platform:${admin.id}`, sessionId: `impersonation:${generateToken().hash.slice(0, 12)}`,
      role: "SUPER_ADMIN", impersonatedBy: admin.id,
    });
    setAuthCookies(res, { accessToken, refreshToken: generateToken().raw, csrfToken: issueCsrf() });
    await audit.record({ action: "platform.impersonate.start", entityType: "Tenant", entityId: tenantId, metadata: { platformId: admin.id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
```
(Note: impersonation sessions are stateless access-token-only in Stage 0 — no `Session`/`RefreshToken` rows — so the refresh cookie is a throwaway and impersonation simply expires in ≤15 min. The full "act as" lifecycle UI/time-boxing is deferred per the spec.)

`apps/api/src/modules/platform/platform.routes.ts`:
```ts
import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./platform.controller.js";

export const platformRoutes = Router();
platformRoutes.post("/impersonate", validateBody(ctrl.impersonateSchema), ctrl.impersonate);
```

Modify `apps/api/src/app.ts` — mount:
```ts
import { platformRoutes } from "./modules/platform/platform.routes.js";
// after properties mount:
app.use("/api/platform", platformRoutes);
```

`apps/api/src/server.ts` (replace stub):
```ts
import { createApp } from "./app.js";
import { env } from "./config/env.js";
const app = createApp();
app.listen(env.PORT, () => console.log(`api listening on :${env.PORT} (base domain ${env.APP_BASE_DOMAIN})`));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/leak-suite/impersonation.test.ts`
Expected: PASS (stamped token + bad-cred reject).

- [ ] **Step 5: Run the whole suite (gate dry-run)**

Run: `npm -w apps/api run test`
Expected: ALL tests pass (leak suite, auth, authz, integration).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(platform): audited impersonation seam (B6) + server entrypoint"
```

---

## Task 17: Thin web auth shell (Vite + React)

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tsconfig.json`
- Create: `apps/web/src/main.tsx`, `apps/web/src/api.ts`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: the API under the same subdomain via Vite proxy.
- Produces: a browser login/logout/whoami loop exercising cookies + CSRF + refresh.

- [ ] **Step 1: Create the web app**

`apps/web/package.json`:
```json
{
  "name": "@hotelsec/web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1", "@vitejs/plugin-react": "^4.3.3", "typescript": "^5.6.3", "vite": "^5.4.10" }
}
```

`apps/web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "acme.lvh.me", port: 5173, proxy: { "/api": "http://acme.lvh.me:3000" } },
});
```

`apps/web/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8"><title>HotelSec</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`apps/web/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "moduleResolution": "Bundler", "module": "ESNext", "noEmit": true }, "include": ["src"] }
```

`apps/web/src/api.ts`:
```ts
function readCookie(name: string): string | null {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null;
}
async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method !== "GET") { const csrf = readCookie("hs_csrf"); if (csrf) headers["x-csrf-token"] = csrf; }
  let res = await fetch(`/api${path}`, { method, headers, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== "/auth/refresh") {
    const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (r.ok) res = await fetch(`/api${path}`, { method, headers, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  }
  return res;
}
export const api = {
  login: (email: string, password: string) => call("/auth/login", "POST", { email, password }),
  me: () => call("/auth/me", "GET"),
  logout: () => call("/auth/logout", "POST"),
};
```

`apps/web/src/App.tsx`:
```tsx
import { useState } from "react";
import { api } from "./api.js";

export function App() {
  const [me, setMe] = useState<{ userId: string; role: string; tenantId: string } | null>(null);
  const [email, setEmail] = useState("admin@acme.test");
  const [password, setPassword] = useState("password123");
  const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    const r = await api.login(email, password);
    if (!r.ok) { setErr("Login failed"); return; }
    const who = await api.me();
    setMe((await who.json()).data);
  }
  async function doLogout() { await api.logout(); setMe(null); }

  if (me) return (<div style={{ padding: 24 }}><h2>Signed in</h2><pre>{JSON.stringify(me, null, 2)}</pre><button onClick={doLogout}>Log out</button></div>);
  return (
    <div style={{ padding: 24, maxWidth: 320 }}>
      <h2>HotelSec login</h2>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button onClick={doLogin}>Log in</button>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
```

`apps/web/src/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 2: Manual browser verification**

Run (three terminals): `npm run db:up`, `npm -w apps/api run dev`, `npm -w apps/web run dev`
Then open `http://acme.lvh.me:5173`, log in with `admin@acme.test` / `password123`.
Expected: the "Signed in" panel shows `role: HOTEL_ADMIN`; DevTools → Application → Cookies shows `hs_at`/`hs_rt`/`hs_csrf` (httpOnly on at/rt). Log out clears them.

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(web): thin React auth shell exercising cookie/CSRF/refresh"
```

---

## Task 18: CI workflow (the release gate)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a CI job that spins up MySQL + Redis, migrates, and runs the full Vitest suite (leak suite included). Merge blocks on failure.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.4
        env: { MYSQL_ROOT_PASSWORD: root, MYSQL_DATABASE: hotelsec_test }
        ports: ["3306:3306"]
        options: >-
          --health-cmd="mysqladmin ping -proot" --health-interval=10s --health-timeout=5s --health-retries=10
      redis:
        image: redis:7
        ports: ["6379:6379"]
    env:
      NODE_ENV: test
      APP_BASE_DOMAIN: lvh.me
      DATABASE_URL: mysql://root:root@127.0.0.1:3306/hotelsec_test
      TEST_DATABASE_URL: mysql://root:root@127.0.0.1:3306/hotelsec_test
      REDIS_URL: redis://127.0.0.1:6379
      JWT_SECRET: ci-test-secret-at-least-32-bytes-long!!
      PLATFORM_ADMINS: '[]'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm -w apps/api run prisma:generate
      - run: npx -w apps/api prisma migrate deploy
      - run: npm -w apps/api run test
```
(Note: the impersonation test needs a real `PLATFORM_ADMINS` hash. For CI, set the repo secret `PLATFORM_ADMINS` to the JSON with the argon2id hash of `platformpass`, and reference it as `PLATFORM_ADMINS: ${{ secrets.PLATFORM_ADMINS }}` instead of `'[]'`. If the secret is absent, mark the impersonation test `it.skipIf(!process.env.PLATFORM_ADMINS_SET)` — but prefer setting the secret so the gate is complete.)

- [ ] **Step 2: Verify locally that the same commands pass**

Run: `NODE_ENV=test npm -w apps/api run prisma:migrate:test && npm -w apps/api run test`
Expected: full suite green against the test database.

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "ci: run migrations + full leak/auth suite as the merge gate"
```

---

## Task 19: Token-cleanup job + worker entrypoint

**Files:**
- Create: `apps/api/src/jobs/token-cleanup.ts`
- Modify: `apps/api/src/worker.ts`
- Test: `apps/api/src/tests/unit/token-cleanup.test.ts`

**Interfaces:**
- Consumes: `basePrisma`.
- Produces: `cleanupExpiredTokens(): Promise<{ refresh: number; auth: number }>`.

> Cleanup operates across all tenants (a maintenance scan), so it uses `basePrisma` directly and deletes purely by time columns — it reads/writes no tenant-scoped business data, only expired auth artifacts. This is the Stage-0 precedent for the Stage-1 scheduler pattern.

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/unit/token-cleanup.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { cleanupExpiredTokens } from "../../jobs/token-cleanup.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

describe("cleanupExpiredTokens", () => {
  it("deletes expired refresh and auth tokens, keeps live ones", async () => {
    const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
    const u = await basePrisma.user.create({ data: { tenantId: t.id, email: "u@t", name: "U", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: "x" } });
    const s = await basePrisma.session.create({ data: { tenantId: t.id, userId: u.id, expiresAt: new Date(Date.now() + 1e6) } });
    await basePrisma.refreshToken.create({ data: { tenantId: t.id, sessionId: s.id, tokenHash: "live", expiresAt: new Date(Date.now() + 1e6) } });
    await basePrisma.refreshToken.create({ data: { tenantId: t.id, sessionId: s.id, tokenHash: "dead", expiresAt: new Date(Date.now() - 1e6) } });
    await basePrisma.authToken.create({ data: { tenantId: t.id, userId: u.id, purpose: "INVITE", tokenHash: "deadat", expiresAt: new Date(Date.now() - 1e6) } });
    const r = await cleanupExpiredTokens();
    expect(r).toEqual({ refresh: 1, auth: 1 });
    expect(await basePrisma.refreshToken.count()).toBe(1);
    expect(await basePrisma.authToken.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w apps/api run test -- src/tests/unit/token-cleanup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/api/src/jobs/token-cleanup.ts`:
```ts
import { basePrisma } from "../shared/prisma/base-client.js";

// Cross-tenant maintenance: prune expired auth artifacts so hot-path tables
// don't bloat. Deletes strictly by time; touches no business data.
export async function cleanupExpiredTokens(): Promise<{ refresh: number; auth: number }> {
  const now = new Date();
  const refresh = await basePrisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } });
  const auth = await basePrisma.authToken.deleteMany({ where: { expiresAt: { lt: now } } });
  return { refresh: refresh.count, auth: auth.count };
}
```

`apps/api/src/worker.ts` (replace stub):
```ts
import { cleanupExpiredTokens } from "./jobs/token-cleanup.js";

const HOUR = 3600_000;
async function tick(): Promise<void> {
  const r = await cleanupExpiredTokens();
  console.log("[worker] token cleanup", r);
}
tick().catch(console.error);
setInterval(() => { void tick(); }, HOUR);
console.log("worker started: hourly token cleanup");
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w apps/api run test -- src/tests/unit/token-cleanup.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite one last time**

Run: `npm -w apps/api run test`
Expected: every test green — this is the Stage-0 gate.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(jobs): expired-token cleanup + worker entrypoint"
```

---

## Definition of done (Stage-0 gate checklist)
- [ ] Fail-closed: query with no context throws (`fail-closed.test.ts`)
- [ ] Leak suite green across every Stage-0 model × risky op (`isolation.test.ts`)
- [ ] Allowlist lock = exactly `{Plan, SharedIntelligenceEntry}` (`allowlist-lock.test.ts`)
- [ ] System-path lock = exactly `{resolveTenantBySubdomain}` (`system-path-lock.test.ts`)
- [ ] Impersonation stamps `impersonatedBy`; impersonator stays tenant-isolated (`impersonation.test.ts`)
- [ ] GUARD can't get a token; reuse-past-grace revokes family; within-grace tolerated (`login.test.ts`, `refresh.test.ts`)
- [ ] Access token ≤ 15 min (enforced by `ACCESS_TOKEN_TTL_SECONDS`, asserted via jwt round-trip)
- [ ] Property scope: admin-all / scoped-assigned / empty-none (`property-scope.test.ts`, `csrf.test.ts`)
- [ ] CSRF rejects header-less state change (`csrf.test.ts`)
- [ ] Lockout after N failures (`lockout.test.ts`)
- [ ] Rate limiter shared across instances (`rate-limit.test.ts`)
- [ ] CI runs the suite and blocks merge (`.github/workflows/ci.yml`)
- [ ] Web shell logs in/out in a real browser (Task 17 manual verification)

---

## Self-review notes (author)
- **Spec coverage:** every Stage-0 spec section maps to a task — kernel (T3–T7), auth transport/login/refresh/invite-reset (T8–T14), RBAC+property-scope (T11,T15), impersonation seam (T16), data model+seed (T2), web shell (T17), leak suite + gate (T6,T16,T18), token hygiene (T19). The five gate locks (fail-closed, leak, allowlist, system-path, impersonation) each have a dedicated test file.
- **Type consistency:** `AccessClaims` (incl. `sessionId`) is defined in T8 and consumed unchanged in T9/T12/T13/T16. `IssuedTokens` defined in T12, reused in T13/T16. `accessiblePropertyIds(): string[] | "ALL"` defined T11, consumed T15. `runSystem(caller, fn)` defined T4, used only in T9 (`resolveTenantBySubdomain`).
- **Deliberate non-placeholders:** `audit.record` logs (no `AuditLog` table until Stage 1.2) and the dev "email" logs a token (no email adapter until Stage 2) — both are explicitly scoped out by the spec, not omissions.
