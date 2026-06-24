# Build Checklist — Hotel Security Operations Platform

The staged build plan. Part of the handoff package:
`schema.md` · `architecture.md` · `module-list.md` · **`checklist.md`** (this file) · `instructions.md`.

**How to use this:** build **one stage at a time, top to bottom.** Every stage ends with a **Test Gate** — a list of tests/checks that must all pass before the next stage starts. Do not proceed on a partially-green gate. The two gates that protect the whole system — the **tenant-isolation leak suite** (Stage 0) and the **outbox reliability test** (Stage 1) — are absolute: a failure there blocks everything after.

**Cross-references:** table numbers → `schema.md`; patterns/§ → `architecture.md`; module #s → `module-list.md`.

---

## Why this order (not "Phase 1 first, Phase 0 later")
Most of Phase 0's *polish* can wait, but its *core* cannot. Tenant isolation, auth, request context, and the kernel are the ground every feature stands on — the fail-closed filter touches every query, so retrofitting it means re-touching and re-testing all of them. So: thin Stage 0 foundation first, then Phase 1 features, then circle back for Phase 0 polish, then fast-follow Phase 2.

```
Stage 0 → Thin foundation (non-negotiable)        [tested as a release gate]
Stage 1 → Phase 1 operational core (MVP features)
Stage 2 → Phase 0 polish (onboarding, devices, notif channels)
Stage 3 → Phase 2 fast-follow (alerts, exceptions, visitors, equipment)
Stage 4+ → Phase 3 analytics, then Phase 4 AI  (gated on demand)
```

**Recurring rule for EVERY stage** (see `instructions.md`): tenant-scoped repositories only · fail-closed filter · no raw SQL without the tenant-asserting wrapper · the leak suite still passes · slow work is a background job · reliable events go through the outbox.

---

## STAGE 0 — Thin foundation (build first)

Goal: a running, multi-tenant-safe skeleton with auth and the kernel. No business features yet.

### 0.1 Project & tooling
- [ ] Node + TypeScript + Express scaffold (strict tsconfig)
- [ ] Prisma + MySQL; `prisma migrate` in a pipeline
- [ ] Redis (cache, queues, rate limit, sockets)
- [ ] ESLint + Prettier + test runner (Vitest/Jest)
- [ ] Zod + argon2 installed; secrets via a manager (nothing committed)
- [ ] Three entrypoints stubbed: `server.ts`, `worker.ts`, `websocket.ts` (`architecture.md` §1)

### 0.2 Shared kernel (`src/shared/`) — `architecture.md` §2
- [ ] `context/` — AsyncLocalStorage store `{ tenantId, userId, role }`
- [ ] `prisma/` — base client + **fail-closed tenant extension** (§4.3)
- [ ] `db/` — read-replica routing stub + **raw-query wrapper requiring tenantId**
- [ ] `errors/`, `http/` (envelope + cursor pagination), `validation/` (Zod, reject unknown)
- [ ] `auth/` — JWT sign/verify + RBAC policy helper

### 0.3 Schema: foundation tables — `schema.md` tables 1–4
- [ ] `Tenant`, `User` (nullable `passwordHash`), `Session`, `UserPropertyAccess`
- [ ] Migration applied; seed a dev tenant + one admin

### 0.4 Auth & request lifecycle — `architecture.md` §3, §4.1
- [ ] Login (argon2id) → access JWT (~15 min) + hashed refresh in `Session`
- [ ] Refresh rotation (reuse ⇒ revoke session)
- [ ] **Hard gate: `GUARD` role can never be issued a session**
- [ ] Logout / revoke (`revokedAt`) + heartbeat force-logout
- [ ] Middleware chain wired in order (§3)
- [ ] `loadContext` populates AsyncLocalStorage; worker `tenantCtx.run()` helper
- [ ] Redis-backed rate limiter (strict on `/auth/*`)

### ✅ STAGE 0 TEST GATE — must be 100% green before Stage 1
- [ ] **Fail-closed proven:** a query on a tenant model with no context **throws**, does not run unscoped
- [ ] **Tenant-isolation leak suite passes** for every tenant model AND every risky op: `findMany`, `findFirst`, `count`, `aggregate`, `groupBy`, `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`, `upsert`, **nested writes**, **raw queries**. (Log in as Tenant A → assert zero Tenant B rows, every time.)
- [ ] `GUARD` cannot obtain a token (test)
- [ ] Refresh-token reuse revokes the session (test)
- [ ] Access token expires ≤ 15 min (test)
- [ ] CI runs the leak suite and **blocks merge on failure**
- [ ] Rate limiter holds across two API instances (integration test)

> If any box above is unchecked, stop. Nothing built later is trustworthy until this is green.

---

## STAGE 1 — Phase 1 operational core (MVP features)

Build in this order; each leans on the one before. Modules 1–6 (`module-list.md`).

### 1.1 Property model — `schema.md` 5–8 · module 0.3
- [ ] `Property → Building → Floor → Zone` CRUD (tenant-scoped)
- [ ] Cache the property tree (`architecture.md` §8), invalidate on write
- [ ] Minimal admin screens to build the hierarchy

**Gate:** [ ] property tree CRUD works single-tenant · [ ] leak suite still green with new tables · [ ] cache invalidates on write (test)

### 1.2 Audit log (wire early) — `schema.md` 23 · module 6
- [ ] `AuditLog` table (append-only; no update/delete path)
- [ ] `audit.record(action, entityType, entityId, metadata)` reads actor from context
- [ ] Confirm nothing in the app can mutate/delete audit rows

**Gate:** [ ] a sensitive action writes an audit row · [ ] no code path can edit/delete an audit row (test)

### 1.3 Outbox (reliability backbone — before logbook) — `schema.md` 11 · `architecture.md` §6
- [ ] `OutboxEvent` table
- [ ] Helper: write an event **in the same transaction** as a state change
- [ ] BullMQ `outbox` relay worker: PENDING → dispatch → PROCESSED, retries + dead-letter
- [ ] Worker re-establishes tenant context from the event

**Gate (absolute):**
- [ ] **Crash test:** kill the relay mid-fan-out → on restart the event still delivers exactly once (idempotent)
- [ ] A rolled-back state change leaves **no** delivered event (same-transaction proof)
- [ ] Failed deliveries land in the dead-letter queue after bounded retries

### 1.4 Report catalog — `schema.md` 12–13 · module 2
- [ ] `ReportType` + `ReportTypeVersion`; seed system types
- [ ] Editing a type creates a **new version** (never mutate old)
- [ ] Admin UI for fields (text/dropdown/photo/yes-no/required) without code

**Gate:** [ ] editing a form creates v2, leaves v1 intact · [ ] an old report still renders against its pinned version (test)

### 1.5 Incident reporting + evidence — `schema.md` 14–16 · module 5
- [ ] `Incident` (filed **only** via a catalog type; `fieldValues` validated against the pinned version)
- [ ] On create: incident **+ OutboxEvent** in one transaction
- [ ] `MediaAsset` upload → object storage, **server-generated key**
- [ ] **Signed-URL-only** access; every touch writes `EvidenceAccessLog`
- [ ] Upload MIME/size validation + queued malware scan before "usable"
- [ ] Duplicate handling: soft-delete (`deletedAt`) + `duplicateOfId`

**Gate:**
- [ ] An incident can only be created through a catalog type (no "basic" path) (test)
- [ ] Evidence is unreachable without a signed link; every access logged (test)
- [ ] Marking a duplicate soft-deletes it but keeps it queryable
- [ ] Leak suite green with the new tables

### 1.6 Security logbook — `schema.md` 22 · module 1
- [ ] `LogbookEntry`; outbox subscriber writes entries (e.g. on `incident.created`)
- [ ] **Point-in-time summary** (editing source does NOT rewrite the entry)
- [ ] Click-through via `sourceType`/`sourceId`
- [ ] `isDuplicate` reflects a soft-deleted duplicate (stays visible, tagged)
- [ ] Manual `NOTE` entries
- [ ] Timeline read API: filter/search/date-range, **cursor pagination**, no JSON blobs in lists

**Gate:**
- [ ] An incident commit always yields a logbook entry (via outbox, survives a worker crash)
- [ ] Editing an incident does not change its historical logbook line (test)
- [ ] A soft-deleted duplicate shows on the timeline tagged "Duplicate"

### 1.7 Staff, shifts & patrol logging — `schema.md` 17–21 · modules 3,4
- [ ] `Shift`, `ShiftAssignment`, `AttendanceEvent`
- [ ] Roster + clock-in/out + coverage-gap detection
- [ ] `PatrolRoute` (with `expectedIntervalMinutes`) + `PatrolLog` (manual: `performedById` guard, `loggedById` operator)

**Gate:** [ ] coverage gap (no-show) is detected (test) · [ ] an overdue round (no log within the interval) is detectable (the query module 14 will use)

### ✅ STAGE 1 OVERALL GATE — before Stage 2
- [ ] **End-to-end:** an operator logs an incident from a catalog type, attaches evidence, sees it on the timeline, and it appears in the audit log — single tenant
- [ ] Outbox survives a worker crash (incident commits, entry still lands)
- [ ] Evidence never reachable without a signed link; every access logged
- [ ] Editing an incident doesn't alter its historical logbook line
- [ ] **Leak suite green across all Stage 1 tables**
- [ ] All section gates above are green

---

## STAGE 2 — Phase 0 polish (now that there's a working MVP)

### 2.1 Onboarding & provisioning (self-serve) — module 0.3
- [ ] Hotel admin creates own tenant + property hierarchy (no manual DB)
- [ ] Invite staff, assign roles, scope to properties

### 2.2 RBAC & session UI — module 0.2
- [ ] Invite/deactivate/reassign; per-property scoping UI
- [ ] Session list per user + **revoke** (effective on next heartbeat)

### 2.3 Notifications backbone (full) — `schema.md` 9–10 · module 0.5
- [ ] `Notification`, `NotificationPreference`; outbox-driven delivery worker
- [ ] Channel adapters: in-app, push (FCM), SMS, email; quiet hours + preferences

### 2.4 Real-time foundation — `architecture.md` §5
- [ ] Socket.IO + **Redis adapter** (add now even with one ws process)
- [ ] Authenticated handshake; rooms `tenant:{id}` and `tenant:{id}:property:{id}`

### ✅ STAGE 2 TEST GATE
- [ ] A brand-new hotel self-onboards and logs an incident **without any manual DB work**
- [ ] A revoked session force-logs-out on next heartbeat (test)
- [ ] A notification fans out per preference and **survives a provider failure** (retry test)
- [ ] A socket event for Hotel A never reaches a Hotel B client (room-isolation test)
- [ ] Leak suite green

---

## STAGE 3 — Phase 2 fast-follow

### 3.1 Alerts & dispatch — `schema.md` 35 · module 15
- [ ] `Alert` (sources: RADIO/GUEST_REPORT/SYSTEM); live command view (Socket.IO); assign/ack/resolve

### 3.2 Manage-by-exception — `schema.md` 34 · module 14
- [ ] `ExceptionRule` config; background checker surfaces: unacknowledged alerts, SLA breaches, overdue patrols
- [ ] Configurable thresholds per tenant

### 3.3 Visitor management — `schema.md` 24–26 · module 7
- [ ] `Visitor`, `VisitorEntry`, `Badge`; entry/exit; evacuation list; watchlist screening

### 3.4 Equipment & key management — `schema.md` 27–28 · module 8
- [ ] `Equipment`, `EquipmentAssignment`; issue/return; missing-item flags

### ✅ STAGE 3 TEST GATE
- [ ] An unacknowledged alert past its threshold is surfaced (test)
- [ ] An SLA breach (config in `ExceptionRule`) is surfaced (test)
- [ ] An overdue patrol (no log within `expectedIntervalMinutes`) is surfaced (test)
- [ ] "Visitors currently inside" reflects open `VisitorEntry` rows (test)
- [ ] Leak suite green across new tables

---

## STAGE 4+ — Later, gated on real customer demand

Do not build ahead of a customer asking. Each is an upsell, not MVP.

### Phase 3 — Analytics & intelligence — `module-list.md` 18–25
- [ ] Operational dashboard (**reads primary**, short cache) — module 18
- [ ] `AnalyticsRollup` jobs **keyed on business time** + **trailing re-roll** (last 3–7 days) — `architecture.md` §9
- [ ] Security/staff analytics, risk heatmaps (read rollups)
- [ ] Report generator (`ReportSchedule`/`GeneratedReport`, async, signed link, retention)
- [ ] Read replicas for historical analytics; **read-your-writes** sticky-to-primary window
- [ ] Compliance & inspection (`InspectionChecklist`/`InspectionRun`)
- [ ] Stakeholder portal (read-only scoped) · PMS integration (`PmsConnection`/`PmsReservationLink`)

**Gate:** [ ] late-arriving data corrects yesterday's rollup after a re-roll (test) · [ ] dashboard never shows a stale count from a replica (test) · [ ] a user sees their own just-written row immediately (read-your-writes test)

### Phase 4 — AI layer — `module-list.md` 26–32
- [ ] `AiJob` async pipeline; narrative generator (human approves before save)
- [ ] Insights/exec reports **two-pass** (code computes numbers, AI writes prose)
- [ ] NL search → validated tenant-scoped filter (never raw SQL)
- [ ] Cross-tenant shared intelligence (`TenantNetworkOptIn` gate first) — extra scrutiny
- [ ] Guardrails: per-tenant opt-in, PII minimization, spend caps, audit AI actions

**Gate:** [ ] AI never writes an official record without human approval (test) · [ ] AI output contains no number not computed in code (review) · [ ] nothing crosses tenants unless `TenantNetworkOptIn.enabled` (test)

### Cross-cutting (slot in as relevant) — `schema.md` 47–54
- [ ] RA 10173: retention/auto-purge job (deletes files too); **anonymize/tombstone** deletion; per-tenant export
- [ ] Billing (`Plan`/`Subscription`/`Invoice`/`Entitlement`); manual invoicing for pilots
- [ ] Pilot enablement: seeded "Sample Hotel"; printable guest-safety collateral
- [ ] Observability: logs w/ request id + tenant; metrics incl. outbox backlog + replica lag; alerts
- [ ] Backups + PITR + **restore drill**

### Open schema items to resolve before the affected tables (`schema.md`)
- [ ] Generalize `MediaAsset` (`ownerType`/`ownerId`) before Lost & Found (table 29)
- [ ] Encrypt `PmsConnection.config` secrets before PMS (table 42)

---

## The "no holes" guarantee — how the files stay in sync
- Every checklist item points at a **table** (`schema.md`), an **architecture section**, and a **module** — if any reference is missing, that's a hole.
- Every **MVP module** in `module-list.md` appears in Stage 0–1.
- Every **architecture non-negotiable** has a **Test Gate** item: isolation → Stage 0 gate; outbox → Stage 1.3 gate; append-only → 1.2 gate; guards-not-principals → Stage 0 gate.
- **Final vs draft** matches `schema.md`: Stages 0–1 build final tables (1–23); Stage 3+ build draft tables (24+), redesigning fields per module first.
