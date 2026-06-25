# Stage 0 Guide — The Foundation Kernel

> A walkthrough for someone new to this codebase. Read this top-to-bottom before
> Stage 1 and you'll understand *what* exists, *how the files connect*, and *why*
> each piece is shaped the way it is. Every source file also has comments now, so
> once you know the map you can dive into any file and it'll explain itself.

---

## 1. What Stage 0 is

This is the backend for a multi-tenant hotel-security SaaS. "Multi-tenant" means
**many separate hotel companies share one running server and one database**, but
each company (a **tenant**) must be *completely walled off* from every other — no
tenant can ever see or touch another tenant's data, even by accident or by a
forgotten `WHERE` clause.

Stage 0 is the **foundation kernel**: the security and plumbing that everything in
later stages sits on top of. It gives us:

- **Hard tenant isolation** (the headline feature — section 2).
- **Authentication**: passwords, login, sessions, refresh tokens, logout.
- **Authorization**: roles (RBAC) and per-property access.
- **The operational seams**: rate-limiting, an audit trail, a background worker,
  and an "impersonation" path for support staff.

There is no business functionality yet (no incidents, no shifts, no reports). Stage
0 is the safe, boring, load-bearing base. If the isolation here is wrong, *nothing*
built on top can be trusted — so this stage is tested far more heavily than its size
suggests (65 tests for ~50 small source files).

---

## 2. The big idea: fail-closed tenant isolation

**The problem.** One MySQL database holds rows for every tenant. Every important
table has a `tenantId` column. The danger is obvious: write one query that forgets
`where: { tenantId }` and you leak Tenant A's data to Tenant B. Humans forget. So we
don't rely on humans remembering.

**The solution** has two halves that work together:

### a) A request context that travels invisibly with each request

When a request arrives, we figure out which tenant it's for and stash that in an
**AsyncLocalStorage** "context" — think of it as a variable that's automatically
available to every function called during this request, without passing it down
through every argument.

> `apps/api/src/shared/context/request-context.ts`
> - `runWithContext(ctx, fn)` — runs `fn` *inside* a context.
> - `getContext()` — read it (may be undefined).
> - `requireContext()` — read it or **throw** if there isn't one.

### b) A Prisma client that stamps `tenantId` for you — or refuses to run

We wrap Prisma (our database library) with an **extension** that intercepts *every*
query:

> `apps/api/src/shared/prisma/tenant-extension.ts`
> - On **reads**, it injects `where: { tenantId }` automatically.
> - On **writes** (`create`/`createMany`/`upsert`), it stamps `tenantId` into the data.
> - If there is **no request context**, it does not "run unscoped just this once" —
>   it **throws `MissingContextError`**. That's what *fail-closed* means: the unsafe
>   path is a crash, not a silent leak.

So the rule for everyday code is simply: **use the scoped client and you literally
cannot forget `tenantId`.**

> `apps/api/src/shared/prisma/index.ts` → `getScopedPrisma()` is the client you use
> everywhere in feature code.

### The two allowlists (and why they're test-locked)

A few things genuinely must cross tenants (e.g. the cleanup worker deleting expired
tokens for everyone). For those we have escape hatches, but they are **narrow and
guarded by allowlists that tests pin in place**, so nobody can quietly widen them:

- `EXEMPT_MODELS = ["Plan", "SharedIntelligenceEntry"]` — the only models that aren't
  tenant-scoped (they're genuinely global). *(tenant-extension.ts)*
- `ALLOWED_SYSTEM_CALLERS = ["resolveTenantBySubdomain"]` — the only function allowed
  to use the unscoped "system" client. *(system-client.ts)*

The leak suite (`tests/leak-suite/allowlist-lock.test.ts`) asserts these lists
*exactly*, so adding an entry without a deliberate, reviewed change breaks the build.

---

## 3. A request's life (GET /api/properties)

Follow one authenticated request from browser cookie to database row. The middleware
order is defined in `apps/api/src/app.ts` and is load-bearing:

1. **Browser** sends `GET /api/properties` to `https://acme.lvh.me:3000` with its
   auth cookies attached.
2. **`resolveTenant`** (`middleware/resolve-tenant.ts`) reads the `Host` header,
   pulls the subdomain (`acme`), looks up that tenant, and puts it on
   `res.locals.tenant`. Unknown host → `404`. *(This lookup is the one sanctioned
   user of the system/unscoped client — it has to be, since it runs before we know
   the tenant.)*
3. **`loadContext`** (`middleware/load-context.ts`) opens the AsyncLocalStorage
   context for that tenant and runs the rest of the request inside it. From here on,
   `getScopedPrisma()` is locked to `acme`.
4. **`authenticate`** (`middleware/authenticate.ts`, on protected routes) reads the
   access-token cookie, verifies the JWT, checks the token's tenant matches the host
   tenant, and enriches the context with `userId`/`role`. Bad/missing token → `401`.
5. **The controller** (`modules/properties/properties.controller.ts`) runs the
   actual logic: it asks `accessiblePropertyIds()` what this user may see, then
   queries `getScopedPrisma().property.findMany(...)`.
6. **The scoped Prisma client** silently adds `where: { tenantId: acme }` and returns
   only Acme's properties — further narrowed to the ones this user is allowed to see.
7. **`ok(res, data)`** wraps the result in the standard JSON envelope. If anything
   threw, **`errorHandler`** (the last middleware) turns it into a clean error JSON.

If step 3 were skipped, step 6 would *throw* rather than leak. That's the whole game.

---

## 4. Map of the codebase

```
apps/
├── api/                         the backend (Express + Prisma + Redis)
│   ├── prisma/
│   │   ├── schema.prisma        the data model (tables + relations)
│   │   └── seed.ts              dev seed: tenant "acme" + users + properties
│   └── src/
│       ├── app.ts              builds the Express app + middleware ORDER
│       ├── server.ts           starts the HTTP server (prod/dev entrypoint)
│       ├── worker.ts           background process: hourly token cleanup
│       ├── websocket.ts        stub for Stage 2 real-time
│       ├── config/             env validation + the platform-admins list
│       ├── middleware/         resolveTenant → loadContext → authenticate
│       ├── shared/             the reusable kernel (see table below)
│       ├── modules/            feature areas: auth, platform, properties, users, audit
│       ├── jobs/               token-cleanup job
│       └── tests/              the proof that all of the above works
└── web/                         a thin React "auth shell" to exercise the cookie flow
```

The most important files to know:

| File | Its job |
|------|---------|
| `shared/context/request-context.ts` | The AsyncLocalStorage request context (the isolation backbone). |
| `shared/prisma/tenant-extension.ts` | Auto-stamps/filters `tenantId`; throws when there's no context. |
| `shared/prisma/index.ts` | `getScopedPrisma()` — the client feature code uses. |
| `shared/prisma/base-client.ts` | The raw, **unscoped** client — dangerous, sanctioned importers only. |
| `shared/prisma/system-client.ts` | Allowlisted escape hatch for the pre-tenant lookup. |
| `middleware/resolve-tenant.ts` | Host → tenant. |
| `middleware/load-context.ts` | Enters the request context. |
| `middleware/authenticate.ts` | Verifies the JWT, enriches the context. |
| `modules/auth/auth.service.ts` | Login, sessions, refresh rotation + theft detection. |
| `shared/auth/*` | Passwords, JWT, cookies, CSRF, tokens, RBAC, property scope. |
| `shared/errors/*` + `shared/http/*` | `AppError`, the error handler, the JSON envelope. |
| `modules/platform/platform.controller.ts` | The impersonation seam. |

---

## 5. Core concepts (each with its file)

### Request context / AsyncLocalStorage — `shared/context/request-context.ts`
Already covered in §2a. The trio `runWithContext` / `getContext` / `requireContext`
plus `MissingContextError` is the entire surface. The scoped Prisma client reads the
context *at query execution time*, which is why tests use the `asContext` helper to
await queries *inside* the scope (see `tests/helpers/context.ts`).

### Scoped vs base vs system Prisma — `shared/prisma/*`
- **scoped** (`getScopedPrisma`): tenant-locked; what you use 99% of the time.
- **base** (`base-client.ts`): no scoping at all. Only seeds, tests, and the cleanup
  job import it — a leak test enforces that boundary.
- **system** (`system-client.ts`): base + an allowlist check so *only* the tenant
  lookup can use it before a tenant is known.

### Passwords — `shared/auth/password.ts`
`argon2id` hashing (slow on purpose, resists brute force). `hashPassword` /
`verifyPassword`. We **never** store raw passwords.

### JWT access tokens — `shared/auth/jwt.ts`
Short-lived (15 min) signed token carrying `tenantId`, `userId`, `sessionId`, `role`,
and optionally `impersonatedBy`. `signAccessToken` / `verifyAccessToken`. Verify
guards against missing claims so a malformed-but-signed token can't sneak through.

### Cookies + CSRF — `shared/auth/cookies.ts`, `shared/auth/csrf.ts`
Login sets three cookies: `hs_at` (access), `hs_rt` (refresh) — both **httpOnly** so
JS can't read them — and `hs_csrf`, which **is** readable by JS. For state-changing
requests the browser must echo the `hs_csrf` value back in an `x-csrf-token` header;
the server checks they match. This is the **double-submit** CSRF defense: an attacker
site can ride the cookies but can't read `hs_csrf` to forge the header.

### Sessions + refresh rotation + theft detection — `modules/auth/auth.service.ts`
This is the cleverest part. Walk it slowly:

- **Login** (`login`) → uniform `"Invalid credentials"` for *every* failure (no user,
  guard, inactive, wrong password) so attackers can't enumerate emails. Every failure
  bumps a lockout counter. On success → `issueSession`.
- **issueSession** creates a `Session` + the first `RefreshToken` and returns the
  cookie bundle.
- **Refresh tokens are single-use.** Each time you refresh (`refresh` → `rotateFrom`),
  we mint a *new* refresh token, mark the old one `usedAt`, and link old→new via
  `replacedById`. That chain is how we tell two situations apart when a *used* token
  shows up again:
  - **Benign double-submit:** the client retried within a short grace window
    (`REFRESH_GRACE_SECONDS`) and the successor is still pristine → we forgive it and
    rotate from the successor.
  - **Theft / replay:** a used token shows up after the grace window → we assume it
    was stolen and `revokeFamily()` — kill the whole session, forcing re-login.
- **Logout** (`revokeSession`) revokes the session family.

### One-time invite / reset tokens — `modules/auth/auth.service.ts` + `modules/users/users.service.ts`
`issueAuthToken` creates an `INVITE` or `PASSWORD_RESET` token, stores only its
**hash**, and returns the raw value to email. `redeemToken` consumes it: it claims the
token atomically (a conditional `updateMany` on `usedAt: null` — only one racer wins),
then sets the password and activates the user. Single-use, race-safe.

### RBAC + property scope — `shared/auth/rbac.ts`, `shared/auth/property-scope.ts`
Roles: `GUARD < SUPERVISOR < SECURITY_MANAGER < HOTEL_ADMIN < SUPER_ADMIN`.
`requireRole` gates routes by role. `accessiblePropertyIds()` answers "which
properties may *this* user see?": admins → `"ALL"`; others → their explicit
`UserPropertyAccess` rows; guards/none → `[]`. Layered *on top of* tenant isolation.

### Rate limiting / login lockout — `shared/rate-limit/limiter.ts`, `shared/redis/client.ts`
Failed logins are counted per `tenant:email` key in Redis. Past
`LOGIN_MAX_FAILURES`, login returns `429` until the window passes. A successful login
clears the counter.

### The impersonation seam — `modules/platform/platform.controller.ts`
Support/operator staff live in **config**, *above* any tenant
(`config/platform-admins.ts`). They can "step into" a tenant. The key design choice:
the issued token is **stateless** — a normal `SUPER_ADMIN` JWT stamped with
`impersonatedBy`, but creating **no** `Session`/`RefreshToken` rows. So it can't be
refreshed, self-expires in ≤15 min, and every start/stop is written to the audit log.

### Background worker / token cleanup — `worker.ts`, `jobs/token-cleanup.ts`
A separate process runs `cleanupExpiredTokens()` at startup and hourly: it deletes
*expired* refresh/auth tokens (cross-tenant maintenance, by time only). The worker
catches rejections on every tick so a transient DB outage can't crash it.

---

## 6. Data model (`prisma/schema.prisma`)

Every business table carries `tenantId` (the isolation key). The shape:

- **Tenant** — one hotel company. Has many Users, Sessions, Properties, tokens.
- **User** — belongs to a Tenant; has a `role` and a `status` (INVITED/ACTIVE/…).
  `passwordHash` is nullable because invited users haven't set one yet.
- **Session** — one logged-in device for a User. `revokedAt` set = ended/burned.
- **RefreshToken** — belongs to a Session. We store only `tokenHash`. The
  `replacedById` self-relation is the **rotation chain** (this token → its
  successor); `usedAt` marks it spent. Together they power benign-retry-vs-theft.
- **AuthToken** — a one-time INVITE or PASSWORD_RESET link (hash only; `usedAt` is the
  single-use guard).
- **Property** — a tenant's hotel/site.
- **UserPropertyAccess** — the many-to-many join deciding which Users may see which
  Properties (the data behind `accessiblePropertyIds()`).

Relationship chain to remember:
`Tenant → User → Session → RefreshToken`, plus `Property ↔ User` via
`UserPropertyAccess`.

---

## 7. How to run & test Stage 0

### A) Run the automated suite (the real proof)

```bash
npm run db:up                 # start MySQL (host :3307) + Redis (host :6380) in Docker
npm -w apps/api run test      # vitest — expect all green, clean output
```

The suite (run serially; `global-setup.ts` migrates the test DB once up front) is
grouped by what it proves:

- **leak-suite/** — the isolation guarantees: fail-closed when there's no context,
  full cross-tenant isolation on every operation, the base-client import boundary,
  the system-path lock, the allowlist contents, and stateless impersonation.
- **auth/** — login (uniform errors, cookies, guards blocked), refresh rotation +
  grace + theft detection, lockout, single-use invite/reset.
- **authz/** — CSRF double-submit, property-scoping per role.
- **unit/** — argon2/JWT/token primitives, the response envelope, subdomain parsing,
  token-cleanup.
- **integration/** — the rate limiter end-to-end through Redis.

A clean run with no stray `console` output *is* part of the contract (tests assert on
pristine output and exact envelopes) — that's why the dev seams log via `console.info`
and the tests silence it.

### B) Manual walkthrough (see it work by hand)

```bash
npm run db:up
npm -w apps/api run prisma:migrate      # apply schema to the dev DB
npm -w apps/api run seed                # tenant "acme"; admin@acme.test / password123
npm run api:dev                         # server on :3000
```

`lvh.me` resolves to `127.0.0.1`, so subdomains work locally. Use a cookie jar:

```bash
BASE=http://acme.lvh.me:3000
JAR=/tmp/hs.cookies

# 1. Log in — should set 3 cookies (hs_at, hs_rt, hs_csrf)
curl -s -c $JAR -b $JAR -X POST $BASE/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@acme.test","password":"password123"}' ; echo
grep -E 'hs_at|hs_rt|hs_csrf' $JAR

# 2. Who am I?
curl -s -b $JAR $BASE/api/auth/me ; echo

# 3. List properties — admin sees ALL (both seeded Acme properties)
curl -s -b $JAR $BASE/api/properties ; echo

# 4. Refresh — issues a new cookie set
curl -s -c $JAR -b $JAR -X POST $BASE/api/auth/refresh ; echo

# 5. Logout — must send the CSRF header (value of the hs_csrf cookie)
CSRF=$(grep hs_csrf $JAR | awk '{print $NF}')
curl -s -c $JAR -b $JAR -X POST $BASE/api/auth/logout -H "x-csrf-token: $CSRF" ; echo

# --- Negative checks (these SHOULD fail) ---
# Unknown tenant host → 404
curl -s -o /dev/null -w '%{http_code}\n' http://nope.lvh.me:3000/api/auth/me
# Logout without the CSRF header → 403
curl -s -o /dev/null -w '%{http_code}\n' -b $JAR -X POST $BASE/api/auth/logout
```

**Browser path** (the React auth shell):

```bash
npm -w apps/web run dev      # then open the printed localhost URL
```

Log in with `admin@acme.test` / `password123`; you should see **"Signed in"** with
your identity, and the three `hs_*` cookies in DevTools → Application → Cookies. The
shell auto-refreshes on a `401` and echoes the CSRF header on logout — it exercises
the exact same contract as the curl flow above.

### C) Confirm the build

```bash
npm -w apps/api run build    # tsc — expect exit 0
rm -rf apps/api/dist         # tidy the build output
npm -w apps/web run build    # tsc -b + vite build — expect clean
```

---

## 8. What Stage 0 deliberately does NOT do yet

So you know exactly where the seams are before Stage 1:

- **Audit is console-only.** `modules/audit/audit.ts` logs structured lines; the
  `AuditLog` *table* write lands in Stage 1.
- **Email is console-only.** Invite/reset links are `console.info`'d in dev; a real
  email adapter is Stage 2.
- **The web app is a thin shell.** `apps/web` exists only to exercise the cookie/CSRF/
  refresh flow in a browser — no routing, no real UI.
- **WebSocket is a stub.** `websocket.ts` just logs; real-time arrives in Stage 2.
- **No business features.** No incidents, shifts, reporting, etc. — those are built
  *on* this kernel.

Everything above is intentional. Stage 0's job was to make the foundation
**impossible to use unsafely**. With that in place, Stage 1 can add features and
trust that tenant isolation, auth, and RBAC simply hold.
