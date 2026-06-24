# Architecture — Hotel Security Operations Platform

System & software architecture. Part of the handoff package:
`schema.md` · **`architecture.md`** (this file) · `module-list.md` · `checklist.md` · `instructions.md`.

Stack: **Node/Express + TypeScript + Prisma + MySQL + Redis (cache + BullMQ) + Socket.IO**, object storage (S3-compatible), React/Tailwind/shadcn (web), React Native/NativeWind (supervisor mobile). **Software-only** — no hardware paths.

Three concerns threaded through every layer: **[SEC]** security, **[SCALE]** scale, **[OPT]** optimization. Each technical section has a *plain-language note*.

**Guiding principle: secure and scalable, not over-built.** Everything is MVP-necessary or a clearly-marked "designed-for-later" seam. No Kubernetes, no microservices, no database-per-tenant until a customer's size forces it.

---

## The four non-negotiables (everything else is secondary)

These appear throughout and gate the build (`checklist.md` enforces them):

1. **Tenant isolation, fail-closed.** Every query gets `tenantId` injected from request context; if context is missing, it **throws** rather than running unscoped. The only exempt models are a tiny, test-locked allowlist (`Plan`, `SharedIntelligenceEntry`). (§4.3)
2. **Transactional outbox.** State changes and their downstream effects are written in one DB transaction; a relay delivers them, made exactly-once by consumer `dedupeKey`s. No "save then send" that can half-fail. (§6)
3. **Append-only logs.** `AuditLog` and `LogbookEntry` are write-once; corrections are new rows; status overlays (like the duplicate tag) are **derived at read time**, never flipped on a written row. Server time is authoritative. (§4.9)
4. **Guards are subjects, not principals.** Roster identities with a nullable `passwordHash`; never issued a session. (§4.1)

---

## 1. Architectural style & topology

**Modular monolith** — one Node app, internally split into domain modules with hard boundaries. Clean separation without distributed-systems overhead; each boundary is a future extraction seam **[SCALE]**.

*Plain terms: one program, tidy separate folders that only talk through clear "front doors." Most of the benefit of many small services, none of the pain of running them. If one part gets huge later, the tidy boundary lets you lift it out.*

**Runtime roles (same image, three jobs):**
```
  Web + mobile + public form ─▶  API process(es)   ─▶ MySQL (primary)
                                 (Express, stateless) ─▶ MySQL (read replica) [SCALE]
                                                       ─▶ Redis (cache + queues)
                                                       ─▶ Object storage (evidence)
                                       │
            ┌───────────────────────────┼───────────────────────┐
            ▼                          ▼                        ▼
     WebSocket process(es)      Worker process(es)         Scheduler
     (Socket.IO + Redis        (BullMQ: outbox relay,     (repeatable jobs:
      adapter) [SCALE]          reports, notifications,    reminders, purges,
                                AI, analytics)             rollups)
```
- One container image run as **api**, **worker**, **websocket** (scheduler = a worker on a timer). Each scales independently.
- All processes **stateless** — shared state lives in MySQL/Redis/storage. For the MVP, run one of each.

*Plain terms: one codebase, three "hats." One answers web requests, one does slow background work, one pushes live updates. Because no hat stores important data only in its own memory, you can run 1 or 10 copies of any hat behind a load balancer. The design allows "add a copy," not "rewrite."*

---

## 2. Project & module structure
```
src/
  modules/            # auth, tenancy, users, properties, logbook, incidents,
                      # shifts, patrols, dispatch, visitors, equipment,
                      # analytics, ai, notifications, audit, outbox
  shared/             # the kernel:
    context/          # per-request "who/which tenant" store (AsyncLocalStorage)
    prisma/           # base client + fail-closed tenant filter
    auth/  validation/ errors/ http/
    queue/ realtime/ cache/ storage/  db/  # db/ = replica routing + raw-query wrapper
  server.ts  worker.ts  websocket.ts        # three entrypoints
```
Each module: `routes → controller → service → repository`. Controllers do HTTP; **services hold business logic and are the only place that calls repositories**; repositories wrap Prisma. Modules call each other service-to-service, never reaching into another's repository.

*Plain terms: every feature has the same four layers, like floors. Top floor (controller) takes the web request. Middle (service) does the thinking. Bottom (repository) is the only one allowed to touch the database. Keeping DB access in one place means a query optimization or cache is a one-spot change.*

---

## 3. Request lifecycle & tenant context
```
helmet → cors → rateLimit → requestId/logger
  → authenticate (verify token)
  → loadContext (tenant + user + role → AsyncLocalStorage)
  → authorize (RBAC + property scope)
  → validate (Zod)
  → controller → service → tenant-scoped Prisma (fails closed)
  → response envelope → error handler
```
- **Tenant context remembered per request** **[SEC]** via `AsyncLocalStorage`. The Prisma filter and audit logger read it automatically — a developer can't forget to scope.
- **Workers re-establish context** by wrapping each job in `tenantCtx.run({ tenantId }, …)` (the job carries its `tenantId`). Without it, the fail-closed filter throws — the desired safety behavior.
- **Response envelope:** `{ data, meta }` / `{ error: { code, message } }`.
- **Validation at the boundary** **[SEC]**: every input checked; unknown fields rejected.

*Plain terms: the instant a request arrives, the system writes an invisible sticky note — "Hotel A, user X, role manager" — that travels with the request everywhere. Any code talking to the DB reads that note automatically and only touches Hotel A's data. Because it's automatic, nobody can forget — the exact mistake that leaks data between hotels.*

---

## 4. Security architecture (primary focus)

### 4.1 Authentication
- **Short-lived access token (~15 min)** + **refresh tokens** stored hashed in **`RefreshToken`** (one row per issued token), not a single hash on `Session`. Access token verified with no DB hit **[SCALE]**.
- **Refresh rotation with reuse-detection (A1):** each refresh marks the presented token `usedAt`, issues a new `RefreshToken`, and links `replacedById`. If a token that's already `usedAt` is presented again, that's a stolen/replayed token ⇒ **revoke the whole session family**. (A single current-hash couldn't tell a replayed old token from garbage — that's why the child table exists.)
- **Invite / password reset (A7):** handled by single-use `AuthToken` rows (`purpose` INVITE/PASSWORD_RESET, hashed, expiring). `INVITED → ACTIVE` happens when the user redeems an INVITE token to set a password.
- **Revocation:** set `Session.revokedAt`; the app logs out on next heartbeat. **Accepted MVP latency:** a revoked session can keep its already-issued access token until it expires (~15 min) + heartbeat — instant kill (Redis revocation list) is §11 "later". UX copy for "revoke" must not promise instant.
- Passwords: **argon2id**; lockout/backoff on repeated failures.
- **Guards can never get a session** — hard-gated against the `GUARD` role; their `passwordHash` is null.
- The **public guest form is unauthenticated** — see §4.5 for how it gets tenant context without a session.

*Plain terms: instead of one forever-token, hand out a 15-minute "day pass" plus a "renewal ticket." A stolen day pass dies fast; the renewal ticket is swapped each use, and reusing an old (already-swapped) ticket means it was stolen → shut the whole login down. Invites and password resets are separate one-time tickets.*

### 4.2 Authorization (RBAC + property scope)
- Per-route policy checks on `User.role`. **Default-deny:** a route with no policy is rejected.
- **Property-scope rule (B8 — explicit):** `HOTEL_ADMIN` and `SUPER_ADMIN` are **tenant-wide** (they ignore `UserPropertyAccess`); `SECURITY_MANAGER` and `SUPERVISOR` are **restricted to their `UserPropertyAccess` rows**; an **empty access set for a scoped role = no property access** (not all). This is the actual authorization logic — enforce it in the `authorize` middleware in addition to the tenant filter (two locks).
- **`SUPER_ADMIN` is the tenant's top admin (B6)** — *not* platform staff. Platform/support staff do **not** get a tenant role that bypasses the filter. Pick one support model and document it:
  - *(default recommendation)* **audited impersonation** — a separate, explicit path that sets tenant context for a support user and writes every action to `AuditLog` with an `impersonatedBy` actor; or
  - **no access** — support never sees tenant data.
  - *Decision pending your confirmation (see `review-resolutions.md` B6).*

*Plain terms: who you are ≠ what you may do. Hotel/super admins see their whole company; managers and supervisors only see the properties assigned to them, and "no properties assigned" means they see nothing (not everything). Your own support staff are not a secret super-role — if they ever need in, it's a separate, fully-logged "act as" path.*

### 4.3 Tenant isolation (the #1 control) [SEC][SCALE]
- A **Prisma client extension injects `tenantId` into every read/write** from request context. No tenant in context ⇒ **throws** (never runs unscoped).
- **Tenant-exempt allowlist (A11 — security-critical):** a hardcoded set of models that legitimately have no normal `tenantId` — exactly **`Plan`** (global) and **`SharedIntelligenceEntry`** (keyed by `originTenantId`). The filter skips injection only for these. Adding to the allowlist requires review, because anything wrongly added becomes a cross-tenant leak. The leak suite must **assert the exempt set is exactly {Plan, SharedIntelligenceEntry}** and fail if any other model is exempt.
- Three things the filter can't do alone, handled in code: **nested writes** (set tenant explicitly), **raw SQL** (goes through a tenant-asserting wrapper), **bulk creates** (filter maps over the array).
- **Leak-test suite:** log in as Hotel A, assert zero rows of Hotel B — for every table and every risky op (findMany, createMany, nested write, aggregate, groupBy, upsert, raw) — plus the allowlist assertion above. **A failure blocks the release.**

*Plain terms: the most important piece. Every query silently gets "...and only for this hotel." A tiny, reviewed list of genuinely-global tables (the price plans, the cross-tenant watchlist) is the only exception — and the tests lock that list so nobody quietly adds a third. The critical choice is "fail closed": if the system ever can't tell which hotel, it refuses rather than guessing.*

### 4.4 Input/output safety
- All input validated; Prisma parameterizes queries (no SQL injection unless someone hand-builds raw SQL → the safe wrapper).
- Output escaped by the frameworks; server-built HTML (PDFs) sanitized; strict headers via `helmet`.

*Plain terms: never paste user text straight into a DB command or a web page. Checked on the way in, neutralized on the way out.*

### 4.5 Rate limiting & abuse [SEC][SCALE]
- **Redis-backed limiter** so limits hold across all copies. Generous for app traffic, strict on auth, **very strict on the public guest form** (per IP + per property) + CAPTCHA + spam scanning.
- **Public guest form tenant context (B1):** the form link carries a **signed/opaque token** (resolved against `GuestFormLink`), *not* the guessable tenant slug. Resolving it sets a **restricted "public" context** (`{ tenantId, propertyId }`) that satisfies the fail-closed filter and is permitted to create **only** a `GuestReport` + a `GUEST`-uploaded `MediaAsset` — nothing else. Links are revocable/expirable. This is the single highest-risk surface, so it's narrow by construction.

*Plain terms: a rate limiter caps tries per window so bots can't hammer login or flood the anonymous form. The public form has no login, so its "which hotel is this for?" comes from a secret token baked into the link (not a guessable hotel name) — and that token only unlocks the ability to file a safety report, nothing more.*

### 4.6 File & evidence security
- Evidence in **object storage, never public**; access only via **short-lived signed links** after a permission check.
- **Signed URLs are minted only when `MediaAsset.scanStatus = CLEAN` (A2)** — a `PENDING` (not-yet-scanned) or `INFECTED` asset is never served. Upload → store → scan (async) → flip to CLEAN → only then serveable.
- Every upload/view/download writes an `EvidenceAccessLog` row.
- Uploads: type/size validated, **malware-scanned** before usable (mandatory for the guest form, where uploads come from anonymous users).
- Storage keys generated server-side; client filenames never trusted. Anonymous uploads are owned via `uploaderType=GUEST` with a null `uploadedById`.

*Plain terms: evidence isn't at a guessable public URL. A freshly-uploaded file is quarantined (`PENDING`) until a malware scan clears it (`CLEAN`); only then can anyone get a temporary link to it. Every touch is recorded — what makes it trustworthy in a claim or police request.*

### 4.7 Secrets, transport, dependencies
- Secrets in a manager, never in the repo. TLS everywhere. Lockfiles + dependency auditing.

*Plain terms: keys live in a vault, not the code; all traffic encrypted; you watch your third-party packages.*

### 4.8 Encryption
- **At rest:** disk/storage-engine encryption on DB + object storage.
- **On the supervisor app:** the offline queue is encrypted with an app-tied key, independent of the phone's PIN.

*Plain terms: data is encrypted on disk and on a supervisor's phone, so a stolen device doesn't hand over readable data.*

### 4.9 Audit & privacy (RA 10173) [SEC]
- `AuditLog` (append-only) records sensitive actions — investigation tool + procurement evidence.
- **Deletion = anonymize/tombstone:** scrub PII, keep the audit reference, so erasure doesn't break the trail.
- **Retention/auto-purge** jobs delete data past a tenant horizon — files too, not just rows.

*Plain terms: privacy law lets a person be deleted, but your audit log must stay intact. Resolution: "tombstone" — wipe identifying details, keep the fact an action happened. Old data auto-purges on a schedule the hotel sets.*

---

## 5. Real-time architecture (dispatch & alerts)
- **Socket.IO** powers the live command/dispatch view and pushes alerts to supervisor devices.
- **Authenticated handshake** **[SEC]**: connection presents its token, joins **rooms** per tenant + per property. Messages are room-scoped — one hotel's alert can't reach another's screens.
- **Redis adapter** **[SCALE]**: needed the moment you run >1 websocket copy; add it from day one (a few lines).
- **Token lifecycle on long connections (B9):** a dispatch screen stays open for hours but the access token is ~15 min — the socket must **re-authenticate in-band on token refresh** (or force a reconnect with a fresh token), so a revoked/expired user stops receiving live alerts. Don't let the socket outlive its token.
- **Fallback:** if the live connection drops, critical alerts also create a `Notification` (push/SMS), so urgent things still arrive.

*Plain terms: "real-time" = the control room sees a new alert instantly without refreshing. Socket.IO keeps a live wire to each screen, grouped into "rooms" by hotel/property so messages only reach the right room. The wire must re-check the user's still-valid login periodically (their 15-min pass expires), and if the wire drops, important stuff still arrives the slower way.*

---

## 6. Background work & the outbox (BullMQ)
Slow work always runs as a background job, never in the web request **[OPT][SCALE]**.
- **Outbox is the reliability backbone.** A state change writes an `OutboxEvent` row **in the same transaction**. A relay drains those rows and fans them out (notifications, the logbook line, follow-on jobs).
- **Exactly-once by design (A4):** consumers are made idempotent by a **`dedupeKey`** unique constraint (`LogbookEntry.dedupeKey`, `Notification.dedupeKey`), so a relay re-run after a crash can't write a second logbook line or notification for the same event.
- **Backoff + safe polling (A5):** `OutboxEvent` carries `nextAttemptAt` (when the next try is due) and `lockedUntil`. The relay claims due rows with `WHERE status=PENDING AND nextAttemptAt<=now() ... FOR UPDATE SKIP LOCKED` so two relays never grab the same row; on failure it pushes `nextAttemptAt` out with exponential backoff.
- **One retry owner (A5):** the **outbox table owns relay retry/DLQ** — a row that exhausts `attempts` becomes `FAILED` (the dead-letter state). BullMQ owns retries only for the **downstream jobs** the relay dispatches (notifications, reports), *not* the relay itself. No stacked retry mechanisms.
- **Queues:** outbox relay, reports, notifications, analytics, ai, maintenance (purges). Each job carries its tenant so isolation applies inside the worker.

*Plain terms: slow tasks shouldn't make users wait, so workers handle them. The risk: if you save an incident then separately send its notification, a crash between loses it. The outbox saves "incident happened + notify" in the very same DB save as the incident — all-or-nothing. A worker then drains it, retrying with growing delays, and a dedup key means even a double-run can't create duplicate timeline lines or notifications. The outbox table — not the job queue — is the single source of truth for those retries.*

---

## 7. Notifications delivery
- Driven by the outbox: a "happened" row becomes `Notification` rows; a delivery worker sends each by the right channel and updates status, retrying on failure.
- Channels behind one interface (in-app, push, SMS, email) — adding one = adding an adapter.
- **CRITICAL bypasses quiet hours (C5):** an emergency/CRITICAL notification must **ignore quiet-hours and per-channel disables** (or always use an always-on channel). A user's "do not disturb" must never silence a life-safety alert.

*Plain terms: "send it" is split from "decide to send it." A provider outage just delays + retries, instead of losing the message. And a genuine emergency overrides anyone's quiet-hours setting — you can't let a "mute" hide a fire alarm.*

---

## 8. Caching & performance [OPT]
- **Redis cache**, keyed per tenant: hot rarely-changing data (property tree, report-type catalog, permissions) + short-lived dashboard results, invalidated on write.
- **Query tuning:** indexes lead with `tenantId`; **cursor pagination** for long timelines; don't load big JSON blobs on lists; avoid N+1.
- **Connection pooling:** cap Prisma's pool per copy, front the DB with a pooler — matters once you run several copies.

*Plain terms: a cache is a fast memory of answers you'd otherwise recompute (the property layout barely changes — remember it). Cursor pagination keeps page 500 as fast as page 1. And avoid firing one query per row in a list (the classic "N+1").*

---

## 9. Analytics & reporting (Phase 3)
Key idea: **dashboards must not scan raw event tables** once data grows **[SCALE][OPT]**.
- **Pre-aggregated rollup tables** (`AnalyticsRollup`) maintained by scheduled jobs. Dashboards read the small summaries.
- **Keyed on business time + trailing re-roll:** because supervisor reports sync late, aggregate by *when it happened* and **recompute the last few days** each run so late data corrects the numbers.
- **Live dashboard** reads current state (short cache) from the **primary** — never a lagging replica.
- **Report generator:** big exports run async → signed download link; small ones inline. Private files, retention horizon.

*Plain terms: counting millions of rows per dashboard load is slow, so a job pre-counts into tiny summary tables. The subtle bit: a guard's report may sync hours late, so always re-count the last few days rather than trusting "yesterday is done" — else late data silently makes charts wrong forever.*

---

## 10. AI layer (Phase 4)
All AI runs **in the background**, **human-in-the-loop** wherever it touches an official record. Tracked in `AiJob`.
- **Narrative generator:** drafts from notes; a supervisor edits + approves before save.
- **Classify/triage:** suggests category/severity — suggestions, not silent actions.
- **Insights & exec reports:** **two-pass** — code computes the numbers, AI only writes prose around them. AI never invents statistics.
- **NL search:** AI emits a validated, tenant-scoped filter (never raw SQL) your normal layer runs.
- **Guardrails:** per-tenant opt-in (`Entitlement`); minimize PII in prompts; cache + spend caps; log AI actions to the audit trail.

*Plain terms: AI assists, never decides. It drafts and suggests; a human presses save. For numbers, the computer does the math and AI only phrases it — so it literally can't invent a false statistic. Each hotel opts in, prompts are minimized, every AI action is logged.*

---

## 11. Scale architecture
- **Stateless horizontal scaling** **[SCALE]**: more api/websocket/worker copies behind a load balancer; shared state in MySQL/Redis/storage. Turn on when load demands.
- **Read replicas + read-your-writes:** heavy historical analytics → replicas; live views and just-after-a-write reads → primary, with a short sticky-to-primary window so a user always sees their own change.
- **Future-proofing (designed-for, not built early):** time-partition big append-only tables (`AnalyticsRollup`, `AuditLog`, `LogbookEntry`) by month once large; indexes already support it.
- **Multi-tenancy at scale:** start shared-DB (tenant column everywhere). If one giant chain ever needs its own DB, the per-request tenant resolver means you can peel them off without rewriting app code.
- **Genuinely later (listed, not built):** per-tenant queue fairness; a Redis token-revocation list for instant session kill.

*Plain terms: "scaling" = add more identical copies, which only works because no copy hoards state. Read replicas are read-only clones that soak up heavy reporting reads — but keep time-sensitive and just-saved data on the main DB so nobody sees stale data. Bigger moves (partitioning, separate DBs) are left as easy future options.*

---

## 12. Deployment & observability
- **Containers:** one image, run as api/worker/websocket. A managed container service is plenty — **no Kubernetes early**.
- **Environments:** dev / staging / prod, isolated DBs + secrets.
- **CI/CD:** typecheck + lint + tests (including the **tenant-isolation leak suite**) gate every deploy.
- **Observability:** structured logs tagged with request id + tenant; metrics (latency, queue depth, error rate, **outbox backlog**, **replica lag**); error tracking; health endpoints. Alert on queue/outbox backlog + replica lag.
- **Backups & DR:** automated DB backups + point-in-time recovery; object-storage versioning; periodic **restore drills**.

*Plain terms: run the same app in separate dev/staging/prod worlds so testing never touches real data. Before code goes live, automated checks (especially data-isolation) must pass. Once live, watch health dashboards — and practice restoring from backup, because an untested backup isn't really a backup.*

---

## 13. Data lifecycle & privacy operations (RA 10173) [SEC]
- **Retention:** per-tenant horizons (`RetentionPolicy`); a daily job purges past them (files too).
- **Legal-hold / open-incident exemption (B5 — design now):** the purge job must **skip records under a legal hold or referenced by an open incident/claim** — otherwise it will happily delete the exact evidence the product exists to protect. Add a `legalHold` flag (on `Incident`/`MediaAsset`) and a "don't purge if open-referenced" rule when retention is built.
- **Deletion:** a first-class anonymize/tombstone op (`DeletionRequest`), not hard delete. *(B4, design now: a `subjectRef` string can't find PII scattered as free text across `Visitor`/`WatchlistEntry`/`GuestReport`/`LostFoundItem` — decide on a real subject entity or a documented PII-field registry the tombstone job walks.)*
- **Tenant offboarding (A8 — decision):** **export-then-purge, not a silent cascade.** Offboarding is a deliberate operation: export the tenant's data, retain `AuditLog`/`EvidenceAccessLog` per the retention policy + any contractual hold, then purge. `onDelete: Cascade` exists for referential integrity within an active tenant, but a raw `DELETE FROM Tenant` is **not** the offboarding path (it would wipe append-only audit/evidence logs, contradicting both immutability and the tombstone rule). Draft scalar-only tables (D2: `WatchlistEntry`, `License`, rollups, etc.) must be included explicitly in this flow since they have no FK cascade path.
- **Export:** a tenant can export its own data (`DataExport`).
- **Consent:** captured at collection (`ConsentRecord`).
- **Audit everything sensitive, immutably.**

*Plain terms: the operational side of the privacy promises — show how long you keep data, prove you delete on schedule, honor a deletion request without breaking records, and hand a hotel a copy of their own data on request. Two safety rails: never auto-purge evidence tied to an open case, and never offboard a hotel with a blunt delete that erases the audit trail — export first, retain what law/contract requires, then purge deliberately.*

---

## Cross-cutting principles (the short list)
1. **Tenant isolation is enforced in code, fails closed, tested as a release gate.** Everything else is secondary.
2. **Reliable events go through the transactional outbox.**
3. **Stateless processes; shared state in MySQL/Redis/storage.**
4. **Slow work is always a background job.**
5. **Dashboards read pre-aggregated summaries keyed on business time, re-rolled over a trailing window.**
6. **Live reads hit primary; only historical analytics read replicas.**
7. **Evidence and generated files are private by default; signed links + access logs only.**
8. **AI drafts/suggests; humans commit; numbers are computed, never invented.**
9. **Modular monolith now; boundaries are the future seams. No premature microservices/Kubernetes/DB-per-tenant.**
10. **Build the MVP, not the roadmap.**

---

## How this maps to the other files
- **`schema.md`** — the tables these patterns operate on (outbox = `OutboxEvent`; rollups = `AnalyticsRollup`; isolation column = `tenantId` everywhere).
- **`module-list.md`** — which product features each architectural piece serves.
- **`checklist.md`** — the build order that turns this architecture into working stages, with the leak suite and outbox as gates.
- **`instructions.md`** — the rules Claude Code applies on every stage.
