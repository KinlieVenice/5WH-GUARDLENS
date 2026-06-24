# Stage 0 — Foundation Kernel — Design Spec

**Project:** Hotel Security Operations Platform (multi-tenant SaaS)
**Sub-project:** Stage 0 — the multi-tenant foundation & auth kernel
**Date:** 2026-06-24
**Status:** Approved design — ready for implementation planning
**Source plan:** `new-md/` package (`instructions.md`, `architecture.md`, `schema.md`, `module-list.md`, `checklist.md`) + reviews (`review-holes-and-questions.md`, `review-round2.md`, `review-resolutions.md`)

---

## 1. Purpose & context

The full product is large (54 tables, five build stages). It is decomposed per `checklist.md`; this spec covers **only Stage 0** — the kernel every later stage stands on. Stage 0 builds a running, multi-tenant-safe backend with cookie-based web auth, plus a thin React shell that logs in/out against it in a real browser. **No product features** (incidents, logbook, patrols, etc.) are in this stage.

Stage 0 is first because the fail-closed tenant filter touches every query; retrofitting it later is a rewrite. This spec also resolves the open foundational decisions surfaced in `review-round2.md` (R2-1 through R2-4, R2-7, plus B6/B8) so the kernel is buildable.

### Decisions locked during brainstorming
| # | Decision | Choice |
|---|----------|--------|
| Tenant resolution | How a user/browser reaches their tenant | **Subdomain per tenant** (`acme.hotelsec.app`); custom domains are a future seam |
| Clients in Stage 0 | Who calls the API | **Web only**; mobile/offline deferred |
| Token transport | Where tokens live | **httpOnly + Secure cookies**, subdomain-scoped, `SameSite=Strict`, + CSRF double-submit |
| Platform support | How platform staff access tenant data | **Audited impersonation**; only the kernel *seam* built now (context field + audit stamping + leak-suite coverage), no support UI |
| Build slice | First deliverable boundary | **Backend kernel + thin web auth shell** (Approach B) |

---

## 2. Scope

### In scope
- **Shared kernel:** request context (`{ tenantId, userId?, role?, impersonatedBy? }`) via `AsyncLocalStorage`; fail-closed Prisma extension; the narrow `prismaSystem` unscoped client; raw-query tenant-asserting wrapper; error/response-envelope/validation/cursor-pagination helpers.
- **Auth:** login; refresh-rotation with reuse-detection + grace window; logout/revoke + heartbeat force-logout; invite & password-reset redemption; argon2id hashing; lockout/backoff; the hard `GUARD`-can-never-get-a-session gate.
- **Authorization:** declarative per-route RBAC (default-deny) + property-scope rule (B8) + impersonation seam (B6).
- **Infra:** subdomain→tenant resolution; Redis-backed rate limiting (shared across instances); httpOnly-cookie + CSRF transport.
- **Data:** tables `Tenant, User, Session, RefreshToken, AuthToken, UserPropertyAccess, Property` (Property table only — no CRUD/UI); one migration; seed script.
- **Web shell:** thin React app (login / logout / `whoami` stub) exercising the cookie/CSRF/refresh loop in a browser.
- **Token hygiene:** repeatable cleanup job purging expired `RefreshToken`/`AuthToken` rows.
- **Proof:** the leak suite + auth/authz integration tests + CI gate.

### Out of scope (deferred to later stages, by explicit decision)
Mobile/offline supervisor app; self-serve tenant signup UI (a seed script stands in); the support-facing "act as" UI and platform-admin management; MFA; any business module (incidents, logbook, patrols, evidence); real-time/Socket.IO; notification delivery; the transactional outbox (Stage 1).

### Success criteria — the Stage-0 Test Gate (must be 100% green)
1. Fail-closed proven: a query on a tenant model with no context **throws**, never runs unscoped.
2. Leak suite passes for every Stage-0 tenant model AND every risky op (`findMany, findFirst, count, aggregate, groupBy, create, createMany, update, updateMany, delete, deleteMany, upsert`, nested writes, raw queries).
3. **Allowlist lock:** the exempt-model set is exactly `{Plan, SharedIntelligenceEntry}` (so no *existing* model is exempt today) and a third can't be added without the test failing.
4. **System-path lock:** the set of `prismaSystem` call-sites is exactly `{resolveTenantBySubdomain}`.
5. **Impersonation:** an impersonator into Tenant A sees only A; audit rows carry `impersonatedBy`.
6. `GUARD` can't obtain a token.
7. Refresh-token reuse (past grace) revokes the session family; a within-grace double-submit returns the successor without revoking.
8. Access token expires ≤ 15 min.
9. Property-scope behaves: admin sees all tenant properties; a scoped role sees only its assigned ones; an empty scoped role sees none.
10. Lockout triggers after N failed logins; `forgot-password` always returns 200.
11. CSRF: a state-changing request without a valid `X-CSRF-Token` is rejected.
12. Rate limiter holds across two API instances (shared Redis).
13. CI runs the suite and **blocks merge** on any failure.

---

## 3. The isolation kernel

### 3.1 Request context
Set once per request via `AsyncLocalStorage`, read automatically by the Prisma filter and the audit logger:
```ts
type RequestContext = {
  tenantId: string;          // always present after resolveTenant
  userId?: string;           // after authentication
  role?: Role;               // after authentication
  impersonatedBy?: string;   // platform staff id, when acting-as
};
```

### 3.2 Three — and only three — database access paths
1. **Scoped client (default for essentially all code).** A Prisma client extension reads `tenantId` from context and injects it into every read/write. **No context ⇒ it throws** (never runs unscoped). It also handles the three things the filter can't do alone: nested writes (set `tenantId` explicitly), bulk creates (map the array), raw SQL (only via the wrapper below). The **exempt-model allowlist** is a hardcoded kernel constant = `{Plan, SharedIntelligenceEntry}`; neither model exists in Stage 0, so **every existing tenant model is scoped, full stop**.
2. **System client (`prismaSystem`) — unscoped, tightly bounded.** Usable **only** by a named, reviewed, test-locked set of functions. In Stage 0 that set has **exactly one** member: `resolveTenantBySubdomain(host) → { tenantId, status }` (reads `Tenant` by `slug`, returns only id + status). This is the resolution to review finding R2-1. The subdomain decision is what shrank the set to one: because the tenant is known from the host before any DB hit, login / refresh / invite-redeem / reset-redeem all run *scoped* (tenant set from host first). Signup (later) and the cross-tenant scanners (outbox relay, schedulers — Stage 1+) will reuse this same disciplined path.
3. **Raw-query wrapper.** Requires an explicit `tenantId` argument and asserts it; the only door to raw SQL.

### 3.3 Middleware order (how context is established)
```
resolveTenant   (host → tenantId; the one prismaSystem call; 404 if unknown, 403 if suspended/canceled)
  → rateLimit   (Redis, keyed tenant + IP)
  → authenticate (verify access JWT; assert JWT.tenantId === host tenantId)  [skipped on login/refresh]
  → loadContext (populate ALS: tenantId always; userId/role/impersonatedBy after auth)
  → authorize   (RBAC + property scope)
  → validate    (Zod; reject unknown fields)
  → controller → service → scoped Prisma
  → response envelope → error handler
```
- Pre-auth endpoints (`login`, `refresh`) receive `{tenantId}` from the host and run **scoped** without a JWT.
- The `JWT.tenantId === host tenantId` cross-check is defense-in-depth: a token minted for Tenant A is useless on Tenant B's subdomain.
- `impersonatedBy` rides in context from day one so the audit logger stamps it (the B6 seam).

---

## 4. Authentication

### 4.1 Transport & CSRF (resolves R2-3)
API is served same-origin under the tenant subdomain (`acme.hotelsec.app/api/*`), so cookies are same-site:
- **Access token** — JWT (~15 min), claims `{tenantId, userId, sessionId, role, impersonatedBy?}`, verified statelessly (no DB hit). httpOnly + Secure cookie, `SameSite=Strict`, subdomain-scoped. (`sessionId` lets logout and the heartbeat target the session without needing the `Path`-scoped refresh cookie.)
- **Refresh token** — opaque random value, stored only as a hash in `RefreshToken`. httpOnly + Secure, `SameSite=Strict`, `Path=/api/auth/refresh`, ~30-day sliding expiry via rotation.
- **CSRF** — double-submit: a non-httpOnly `csrfToken` cookie the SPA echoes in an `X-CSRF-Token` header on every state-changing request; the server compares the two. (SameSite=Strict already blocks cross-site requests; the token is defense-in-depth.)

### 4.2 Login `POST /api/auth/login {email, password}`
Tenant already known from host. Find `User` by `(tenantId, email)`; verify argon2id. **Hard gate: `role === GUARD` ⇒ reject** (guards never get a session); also reject non-`ACTIVE` users. On success: create a `Session` + first `RefreshToken` (store only the hash); set the access, refresh, and csrf cookies. **Lockout/backoff:** a Redis counter keyed `tenant + email + IP`, exponential backoff then a temporary lock after N failures. Generic error messages (never reveal whether the email exists).

### 4.3 Refresh + reuse-detection + grace (resolves R2-4) `POST /api/auth/refresh`
Look up the presented token by hash (scoped to the host tenant). Then:
- **`usedAt` is null →** normal **rotation**: mark `usedAt = now`, mint a new `RefreshToken`, set the old row's `replacedById`, reissue cookies.
- **`usedAt` is set →** possible replay. **Grace rule:** if it was rotated within **~20 seconds** *and* its `replacedById` successor exists and is itself unused, return that successor (idempotent — absorbs parallel-tab / double-submit without nuking the session). **Otherwise** (used long ago, or the successor was *also* already used = a real replay chain) ⇒ **theft ⇒ revoke the entire session family** (`Session.revokedAt` + revoke all of that session's `RefreshToken` rows).

### 4.4 Logout, revoke, heartbeat
`POST /api/auth/logout` sets `Session.revokedAt` (by `sessionId` from the access-token claims) and revokes that session's `RefreshToken` rows, then clears cookies. A periodic `whoami` heartbeat checks `revokedAt` and force-logs-out. **Accepted revocation latency = access-token TTL (≤15 min) + heartbeat interval** (decision B2; instant kill via a Redis revocation list is a later-stage option). Revoke UX copy must not promise instant logout.

### 4.5 Invite & password reset
Single-use `AuthToken` rows (hashed, expiring — invite ~7 days, reset ~1 hour; one-time use enforced by `usedAt`):
- **Invite:** an admin creates `User(status=INVITED, passwordHash=null, role=<chosen>)` and an `AuthToken(purpose=INVITE)`. The emailed link points at the tenant subdomain; redeeming it sets the password (argon2id) and flips status to `ACTIVE`.
- **Reset:** `POST /api/auth/forgot {email}` → if the user exists, issue an `AuthToken(purpose=PASSWORD_RESET)` and email it; **always return 200** regardless, to avoid account enumeration. Redeeming sets a new password.

### 4.6 Token hygiene (resolves R2-7)
A small repeatable cleanup job deletes `RefreshToken` rows past expiry (beyond the reuse-detection window) and expired `AuthToken` rows, so the auth hot-path tables don't bloat.

---

## 5. Authorization

### 5.1 RBAC, default-deny
A declarative policy helper attaches required role(s) to each route; a route with **no** policy is rejected. Enforced in `authorize` after `loadContext`. Role order: `GUARD < SUPERVISOR < SECURITY_MANAGER < HOTEL_ADMIN < SUPER_ADMIN`.

### 5.2 Property scope (B8) — the second lock
The tenant filter is the first lock; property scope is the second:
- `HOTEL_ADMIN` / `SUPER_ADMIN` → **tenant-wide**; ignore `UserPropertyAccess`.
- `SECURITY_MANAGER` / `SUPERVISOR` → **restricted** to their `UserPropertyAccess` rows.
- A scoped role with **no** access rows → **sees nothing** (not everything).

Stage 0 has no property-bound features, so a single read-only `GET /api/properties` endpoint is included as the concrete surface that applies and tests this rule. No property CRUD/UI (that is Stage 1.1).

### 5.3 Impersonation seam (B6) — mechanism only
Platform staff are a **separate identity outside the tenant role model**, backed minimally by **secrets-configured `PlatformAdmin` credentials** (`id + label + argon2 hash` from the secrets manager) — **no DB table, no self-serve platform accounts**. One guarded endpoint, `POST /api/platform/impersonate`, gated by the platform credential, mints a normal tenant access token with `impersonatedBy=<staffId>` in its claims/context. Everything then flows through the ordinary scoped kernel (an impersonator sees only the target tenant), and the audit logger stamps `impersonatedBy` on every write plus on impersonation start/stop. Deferred: the support-facing "act as" UI, session time-boxing UX, and platform-admin management. Built now: the context field, audit stamping, and leak-suite coverage — so the seam never has to be retrofitted into the kernel.

---

## 6. Data model

Built exactly as v1.1 `schema.md` defines them — **no field changes**:
`Tenant`, `User`, `Session`, `RefreshToken` (4a), `AuthToken` (4b), `UserPropertyAccess`, `Property`.

- **Enums needed now:** `Role`, `TenantStatus`, `UserStatus`, `AuthTokenPurpose`. (Other enums belong to later stages.)
- **No new tenant tables.** The impersonation seam adds zero schema surface (platform admins are config-provided).
- **One Prisma migration** creates these seven tables + the four enums.
- **Seed script** creates: the first `Tenant` (with `slug`); a `HOTEL_ADMIN` (password set); and — for B8 testing — a couple of `Property` rows plus a `SUPERVISOR` scoped via `UserPropertyAccess`.

---

## 7. Web auth shell

Thin React app (Vite + React + Tailwind/shadcn, per the stack): a login page, logout, and a stub "you're in" screen showing `{tenant, user, role}` from `whoami`. Refresh happens transparently via cookie; the CSRF token is wired into a shared fetch helper that attaches `X-CSRF-Token` to state-changing requests. Just enough to drive the cookie/CSRF/refresh loop in a real browser — **no product UI**.

---

## 8. Testing & verification (this *is* the Stage-0 gate)

- **Leak suite** — for every Stage-0 tenant model (`Tenant, User, Session, RefreshToken, AuthToken, UserPropertyAccess, Property`) × every risky op (`findMany, findFirst, count, aggregate, groupBy, create, createMany, update, updateMany, delete, deleteMany, upsert`, nested writes, raw): logged in as Tenant A, assert **zero** Tenant B rows.
- **Fail-closed** — a query with no context throws.
- **Allowlist lock** — the exempt-model constant equals exactly `{Plan, SharedIntelligenceEntry}`.
- **System-path lock (R2-1)** — the set of `prismaSystem` call-sites equals exactly `{resolveTenantBySubdomain}`; fails if a second unscoped caller appears. (Implemented via an explicit registry the system client checks its caller against, asserted in a test.)
- **Impersonation** — an impersonator into A sees only A; audit rows carry `impersonatedBy`.
- **Auth** — `GUARD` can't get a token; rotation works; reuse past grace revokes the family; a within-grace double-submit returns the successor without revoking; access token ≤15 min; lockout after N failures; invite/reset single-use; `forgot-password` always 200.
- **Property-scope (B8)** — admin-sees-all / scoped-sees-assigned / empty-scoped-sees-none.
- **CSRF** — a state-changing request without a valid `X-CSRF-Token` is rejected.
- **Rate limiter** — holds across two API instances (shared Redis), integration test.
- **CI** — runs the whole suite and **blocks merge** on any failure.

---

## 9. Open items intentionally deferred past Stage 0
These are recorded so they aren't lost; none block Stage 0:
- Incident-response SLA columns on `Incident` (C3) — decide before Stage 1.5 locks `Incident`.
- Client `Idempotency-Key` on replayed write endpoints (R2-5) — design with the mobile/offline stage.
- Polymorphic `MediaAsset` owner-validation + purge enumeration (R2-6) — Stage 1.5 / retention.
- `correctsId` self-link on `AuditLog`/`LogbookEntry` (A12) — cheap nullable add when those are built.
- MFA (B7); instant session-kill via Redis revocation list (B2) — later, additive.

---

## 10. Definition of done
Every in-scope item implemented; the Stage-0 Test Gate (§2) is 100% green; the leak suite runs in CI and blocks merge; results reported per gate item. Only then does Stage 1 begin.
