# Review — Round 2 (v1.1 package)

**Reviewer stance:** senior engineer, security + scale. Re-reviewed the full package after the v1.1 fixes (`review-resolutions.md`) were folded in.

**Verdict up front:** v1.1 is materially better. The round-1 holes are genuinely closed — refresh-token lineage, `AuthToken`, scan-gated polymorphic `MediaAsset`, outbox `dedupeKey`+`nextAttemptAt`, read-time duplicate derivation, zone FKs, the `_ALL` sentinel, the allowlist lock, and the emergency/guest-form tables are all correct and well-documented. The decisions (export-then-purge offboarding, derive-at-read duplicate tag, outbox-owns-retry) are the choices I'd have made.

**But** the isolation model got *stricter* ("fail closed, and the exempt set is **exactly** `{Plan, SharedIntelligenceEntry}`, asserted by the leak suite") without defining where the **unavoidable non-tenant-scoped operations** live. That strictness now visibly collides with operations the system cannot function without. That's the headline finding (R2-1) and it's a **Stage-0 kernel** issue — the most expensive thing to retrofit, which is exactly why it must be settled before the filter is written.

Severity: 🔴 blocker (resolve before the stage that needs it) · 🟠 important · 🟡 minor/later.

---

## R2-1. 🔴 The fail-closed filter has no defined home for pre-context lookups or cross-tenant system scans

This is the big one. The rule is now: *every query throws without tenant context, and only `Plan` + `SharedIntelligenceEntry` are exempt — the leak suite fails if a third model is exempt.* That's a great invariant for **request-path** queries. The problem is there are **two whole classes of legitimate queries that run with no tenant context (or across all tenants)**, and none of them are `Plan`/`SharedIntelligenceEntry`. As written, the kernel would throw on all of them — or someone will quietly punch a hole in the filter that the leak suite is specifically designed to forbid.

**Class I — unauthenticated / pre-context lookups** (no JWT yet, so `loadContext` hasn't run):
- **Login** — must find the `User` by email. But email is `@@unique([tenantId, email])` — unique *only within a tenant* — so login must first resolve the **`Tenant`** (by slug/subdomain). Both the `Tenant` lookup and the `User` lookup happen with no context. (`Tenant` isn't exempt either.)
- **Token refresh** — the client presents only the opaque refresh token; you look up **`RefreshToken` by `tokenHash`** to discover which session/tenant. No context yet. `RefreshToken` is explicitly *not* exempt (schema line 24).
- **Invite / password-reset redeem** — look up **`AuthToken` by `tokenHash`** before you know the user/tenant.
- **Guest-form resolve** — look up **`GuestFormLink` by `tokenHash`** to *establish* `{tenantId, propertyId}`. This is a chicken-and-egg: you must read a tenant-scoped table to discover the tenant. (B1's "resolving it sets context" hand-waves the lookup that happens *before* context exists.)
- **Self-serve signup** (Stage 2) — *creates* a `Tenant` + its first `HOTEL_ADMIN` `User` with no tenant context at all.

**Class II — cross-tenant system scans** (background work that must span tenants to find work, *then* narrow):
- **Outbox relay** — `WHERE status=PENDING AND nextAttemptAt<=now() ... FOR UPDATE SKIP LOCKED` reads **all tenants'** `OutboxEvent` rows, then does `tenantCtx.run({tenantId})` per event. The claim SELECT is cross-tenant and pre-context.
- **Schedulers** — the manage-by-exception checker ("checks continuously"), license/cert-expiry reminders, retention/auto-purge, analytics rollups: each must scan across tenants to discover what work exists before it can enqueue per-tenant jobs.

The architecture only says workers "re-establish context by wrapping each job in `tenantCtx.run({tenantId})` — *the job carries its tenantId*." That covers the *per-tenant* job once it's enqueued. It says nothing about the **dispatcher** that scans across tenants to *create* those jobs — and that dispatcher is unavoidable.

**Why it matters:** the fail-closed filter is built in **Stage 0.2**, and the leak suite that locks the exempt set to exactly two models is the **Stage 0 absolute gate**. If these paths aren't designed into the kernel now, you'll either (a) fail the gate, or (b) bolt on an unscoped escape hatch later — and a bug in *that* path is precisely the cross-tenant leak the whole design exists to prevent. This is the "retrofitting the filter is a rewrite" risk the docs themselves cite.

**Fix (design into the kernel, Stage 0):** define a small, explicit, audited **"system / bootstrap query" path** that is distinct from the model-exempt allowlist. Concretely:
- A dedicated unscoped client (e.g. `prismaSystem`) usable **only** by a named, reviewed set of operations: `resolveTenantBySlug`, `findRefreshTokenByHash`, `findAuthTokenByHash`, `resolveGuestFormLink`, `signupCreateTenant`, and the relay/scheduler **claim** queries.
- Every bootstrap lookup is keyed **only** by a high-entropy `@unique` hash or the slug (so it can't enumerate or leak — you either have the exact token or you get nothing), and returns the **minimum** needed to set context, after which all further work goes through the normal scoped client.
- The leak suite gets a **second** assertion: the system-path usages are exactly this named set (mirror the allowlist lock). Two locks, two tested lists.
- Document this as the explicit, narrow exception class in `architecture.md` §4.3 — right now §4.3 reads as if it doesn't exist, which is the gap.

This isn't a redesign — it's making explicit a path you already need six times. But it must be named and tested, because it's the one part of the system that legitimately runs unscoped.

---

## R2-2. 🔴 Login can't identify the tenant (email is unique per-tenant, not global)

Sub-problem of R2-1 but it deserves its own line because it blocks the *first* feature built. `@@unique([tenantId, email])` means the same email can exist in two hotels, so `login(email, password)` is ambiguous. Something must supply the tenant: subdomain (`acme.app.com`), the `Tenant.slug` in the URL/path, or a tenant picker. This is undefined, and it's a **Stage 0.4** dependency (you can't write login without it). It also determines the shape of R2-1's `resolveTenantBySlug`.

**Decision needed:** how is the tenant established at login? (Recommend subdomain or slug-in-path → `Tenant.slug`, which already exists and is `@unique`.) Then `RefreshToken`/`AuthToken` resolution by global token hash needs no tenant qualifier, but login does.

---

## R2-3. 🔴 Token storage + CSRF posture is still deferred — but Stage-0 auth can't be built without it

`review-resolutions.md` lists B3 under "deferred (design-now, build-later)," but the web refresh flow is **Stage 0.4**. You must decide *before* writing auth: does the refresh token live in an `httpOnly`+`SameSite` cookie (→ you now need CSRF protection on `/auth/refresh` and all state-changing routes) or in a JS-readable store (→ contradicts the "no browser storage" rule, and exposes it to XSS)? "Access token in memory, refresh token in httpOnly cookie + CSRF tokens" is the standard answer and I'd recommend it — but it's a Stage-0 decision, not a later one, and it interacts with R2-1 (the refresh lookup) and the Socket.IO handshake (§5).

**Pull B3 forward into the Stage-0 auth design.**

---

## R2-4. 🟠 Strict refresh-reuse detection will spuriously nuke sessions on concurrent/replayed refreshes

The reuse rule — "a re-presented `usedAt` token ⇒ revoke the whole session family" — is correct against theft but is a well-known footgun against **legitimate** double-submits:
- A client fires two refreshes in parallel (common on app resume / parallel 401-retries). First rotates the token; second presents the now-`usedAt` token → flagged as theft → **whole family revoked → user logged out**.
- Worse with the **offline supervisor app (0.4)**: on reconnect it replays a queue of requests, some carrying a stale (already-rotated) token → guaranteed false-positive revokes.

**Fix:** add a small grace window. Standard pattern: when a token with `usedAt` set is presented *and* it was rotated within the last N seconds *and* its `replacedById` chain is intact (not a detected theft pattern), return the already-issued successor token instead of revoking. Only revoke on reuse of a token whose successor was *also* already used, or outside the grace window. Cheap to implement on the `RefreshToken` lineage you already have (`replacedById` + `usedAt` make it computable), but it must be designed in — a naive implementation of the Stage-0 gate will log real users out.

---

## R2-5. 🟠 Offline replay needs client idempotency keys on write endpoints (the outbox `dedupeKey` doesn't cover this)

`dedupeKey` makes the **internal** outbox fan-out exactly-once. It does **not** protect against the **client** creating duplicates. The offline app (0.4) queues writes and replays on reconnect; if a response was lost, it replays `POST /incidents` and you get **two incidents** (two outbox events, two logbook lines — each internally correct, but duplicated at the source). Conflict handling is mentioned but no boundary-level idempotency mechanism is specified.

**Fix:** accept a client-supplied `Idempotency-Key` header on mutating endpoints the mobile app replays (incident create, patrol-log create, attendance). Store it (a small `(tenantId, idempotencyKey) @unique` ledger or a key column on the created row) and return the original result on replay. This is the offline-first counterpart to the outbox's internal dedupe — design it alongside 0.4.

---

## R2-6. 🟠 Polymorphic `MediaAsset` reintroduces the exact integrity gap A9 just closed — and orphans the table for purge

Making `MediaAsset` polymorphic (`ownerType`/`ownerId`, no FK) was the right call for reuse, but note the asymmetry it created:
1. **Integrity:** A9 just converted `zoneId` from a bare scalar to a real FK *because* loose scalars allow pointing at non-existent / wrong-tenant rows. The same change made `MediaAsset.ownerId` a bare scalar — re-opening that exact gap for evidence ownership. Defensible (it's the established loose-pointer pattern), but the service **must** validate, on attach, that the owner exists *and* is same-tenant — and there's now no DB safety net, unlike everywhere else evidence is involved. Worth an explicit service-layer rule + a note that this is a conscious trade (loose pointer chosen over FK for cross-module reuse).
2. **Offboarding/purge coverage:** `MediaAsset` now has **no FK to any parent** (the `Incident.media` relation is gone and it never had a `tenant` relation). So under the export-then-purge offboarding (A8) it's an orphan with no cascade path — same problem as the D2 scalar-only draft tables. It (and its object-storage blobs) must be **explicitly enumerated** in the purge/offboarding flow and the retention job. Add `MediaAsset` to the D2 "scalar-only tables to include explicitly" list.
3. **Redundant forward pointers (draft):** `LostFoundItem.proofMediaId` and `GuestReport.photoMediaId` are forward pointers to a media row, but the polymorphic owner pointer now also lives on `MediaAsset` (`ownerType="LostFoundItem"/"GuestReport"`). Two directions for one link that can disagree. When you spec those modules, pick one — I'd drop the forward pointers and use the reverse `ownerType/ownerId` lookup, consistent with how incident media now works.

---

## R2-7. 🟠 Auth-token tables grow unbounded on the hot path — no cleanup defined

`RefreshToken` is one row per issued token, and you deliberately **keep used ones** for reuse-detection. An active user refreshing every ~15 min generates ~100 rows/day/session; multiply by users and devices. `AuthToken` similarly accumulates spent invites/resets. Nothing purges them. This is an operational hole on the **auth hot path** (index bloat → slower refresh lookups, the most frequent authenticated operation).

**Fix:** a maintenance job that deletes `RefreshToken` rows past `expiresAt` by more than the reuse-detection window, and `AuthToken` rows past `expiresAt`. Keep enough lineage to detect reuse within the refresh-token validity period; purge the rest. Small scheduled job; specify it with the other maintenance jobs.

---

## R2-8. 🟡 `dedupeKey` is globally `@unique`, not tenant-scoped

`LogbookEntry.dedupeKey`/`Notification.dedupeKey` are `@unique` (global). It's *safe only if* the relay always derives the key from a globally-unique id (e.g. `outboxEventId`, a cuid) — which it should. But a global unique index on a tenant-scoped table is a mild isolation smell (one tenant's insert can in principle fail on another tenant's key) and breaks the "every uniqueness/isolation check leads with `tenantId`" convention used everywhere else.

**Fix:** either make it `@@unique([tenantId, dedupeKey])` (convention-consistent, and the tenant filter scopes the dedupe-on-insert naturally), or add a one-line note that `dedupeKey` is *always* derived from a globally-unique identifier and never from a per-tenant value. Low risk, but pin it so an implementer doesn't build the key from `sourceId + a per-tenant counter`.

---

## R2-9. 🟡 Define the disposition of an `INFECTED` asset and of stuck `PENDING`

Scan-gating is correct, but two states are undefined:
- **`INFECTED`:** never served (good) — but is the storage blob deleted, the uploader/operator notified, the owning incident flagged? For the **anonymous guest form** (mandatory scan, untrusted uploader) this needs a defined outcome, not just "no signed URL."
- **Stuck `PENDING`:** if the scan worker is down, assets sit `PENDING` (unviewable) indefinitely. Need a timeout/retry + an alert (tie into the outbox-backlog/queue-depth observability already specified).

Both are small, but "before usable" implies a defined lifecycle for the not-usable states.

---

## R2-10. 🟡 Incident-SLA decision (C3) is a Stage-1.5 gate, not a "later" — but it's cheap

Correctly flagged as "decide before locking FINAL `Incident`." Reinforcing: `Incident` is built in **Stage 1.5**, and the manage-by-exception `incident_sla` metric (Stage 3) is unmeasurable without `acknowledgedAt`/`respondedAt`. The good news: adding **nullable** timestamp columns later is a non-breaking, near-free migration — so this is lower-risk than "locked FINAL" implies. My recommendation: **add `acknowledgedAt` (+ optionally `respondedAt`) now** as nullable columns even if unused at MVP; it costs nothing and saves a migration + a backfill-of-meaning later. Just confirm incident-response SLAs are a product goal at all.

---

## R2-11. 🟡 Doc sync nits (the kind the "no holes" guarantee is meant to catch)

- **`module-list.md` §9 (Lost & Found)** still says *"(Needs `MediaAsset` generalized — see `schema.md` open items.)"* — that item is now **resolved** in v1.1. Stale; update so the files don't contradict on whether it's open.
- **Zone validation reminder (A9):** the service must fetch the zone **through the tenant-scoped client** before validating `zone.propertyId === record.propertyId`. The FK only guarantees the zone *exists*, not that it's same-tenant/same-property; trusting the raw `zoneId` from the request and validating against a separately-fetched-but-unscoped zone would defeat it. Worth one explicit line in the Stage-1.1/1.5 zone-FK gate.

---

## What's solid (proceed with confidence)

To be clear about scope — these round-1 areas are now closed and I'd build on them as-is: refresh-token lineage (modulo R2-4's grace window), `AuthToken`, scan-gated polymorphic `MediaAsset` (modulo R2-6), outbox idempotency + backoff + single retry owner, read-time duplicate derivation, zone FKs, `_ALL` rollup sentinel, the allowlist concept and its leak-suite lock, CRITICAL-bypasses-quiet-hours, the export-then-purge offboarding decision, and the legal-hold/PII-registry items correctly parked as design-now-build-later.

---

## The short list — settle before Stage 0 / Stage 1 code

In priority order, the items that touch the kernel or the first features and are expensive to retrofit:

1. **R2-1** — define and test the "system/bootstrap unscoped query" path (login, refresh, token-redeem, guest-link, signup, relay/scheduler claims) as an explicit, narrow, audited exception alongside the model allowlist. *Stage 0.2 kernel.*
2. **R2-2** — decide how login resolves the tenant (subdomain/slug). *Stage 0.4.*
3. **R2-3** — decide refresh-token storage + CSRF posture. *Stage 0.4.*
4. **R2-4** — design the refresh-reuse **grace window** so concurrent/offline replays don't nuke real sessions. *Stage 0.4.*
5. **R2-5** — client `Idempotency-Key` on replayed write endpoints. *Design with 0.4; enforce at 1.5/1.7.*
6. **R2-6 / R2-7** — add `MediaAsset` to the purge enumeration + service-validate owner same-tenant; add the auth-token cleanup job.
7. **R2-10** — make the incident-SLA call now (recommend: add the nullable columns).

Everything else (R2-8, R2-9, R2-11) can be handled at its module's build time without rework.
