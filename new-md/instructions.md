# Instructions for Claude Code — Hotel Security Operations Platform

Read this first. It tells you how to use the other files and the rules that apply to **every** task. The package:

- **`module-list.md`** — what the product does (features, by phase).
- **`schema.md`** — the data model (Phase 0–1 tables 1–23 + 4a/4b are FINAL; Phase 2–4 + cross-cutting are DRAFT).
- **`architecture.md`** — how it's built (patterns, security, the non-negotiables).
- **`checklist.md`** — the build order, with a **Test Gate** after every stage.
- **`review-resolutions.md`** — changelog of fixes applied after a senior review; lists decisions you can override.
- **`instructions.md`** — this file.

> **v1.1.** A senior review (`review-resolutions.md`) was folded in: refresh-token lineage (`RefreshToken`), invite/reset tokens (`AuthToken`), polymorphic + scan-gated `MediaAsset`, outbox idempotency/backoff, read-time duplicate derivation, zone FKs, the tenant-exempt allowlist, and emergency/guest-form tables. Where a fix was a judgment call it's marked as a **decision** in that file — flag it if you'd choose differently.

---

## What we're building (one paragraph)
A multi-tenant, **software-only** hotel security-operations SaaS. Users are the control room, supervisors, managers, and owners. **Line guards never use the system** — they report by radio and the control room logs for them. There is **no hardware** anywhere (no patrol devices, NFC tags, panic buttons, CCTV analytics). The product digitizes a control desk: logbook, incidents, patrols, people/assets, then analytics and AI on top — on a multi-tenant foundation where tenant isolation is the #1 control.

---

## The 4 non-negotiables (never violate these)
1. **Tenant isolation, fail-closed.** All tenant data goes through the tenant-scoped Prisma client, which injects `tenantId` from request/worker context. **If context is missing, throw — never run an unscoped query.** The only exempt models are a test-locked allowlist: exactly **`Plan`** and **`SharedIntelligenceEntry`**. Handle the three gaps explicitly: nested writes (set `tenantId`), raw SQL (use the tenant-asserting wrapper), bulk creates (map the array). See `architecture.md` §4.3.
2. **Transactional outbox for reliable events.** When a state change must trigger downstream effects (notifications, logbook entries), write an `OutboxEvent` **in the same transaction** as the change; a relay delivers it (idempotent via consumer `dedupeKey`s; backoff via `nextAttemptAt`; the outbox table owns retry/DLQ). Never "save then separately enqueue." See `architecture.md` §6.
3. **Append-only logs.** Never update or delete `AuditLog` or `LogbookEntry` rows. Corrections are new rows; status overlays (the duplicate tag) are **derived at read time**, never flipped on a written row. Server time is authoritative. See `architecture.md` §4.9.
4. **Guards are subjects, not principals.** Guards are roster rows with `passwordHash = null` and role `GUARD`. **A `GUARD` can never be issued a session** — gate this in code. See `architecture.md` §4.1.

If a request would violate one of these, stop and flag it rather than working around it.

---

## How to work through the build
- **Follow `checklist.md` one stage at a time, in order.** Do not skip ahead. Later stages assume earlier **Test Gates** are green.
- **Do not start a stage until the previous stage's Test Gate is 100% green.** The two absolute gates are the **tenant-isolation leak suite** (Stage 0) and the **outbox crash test** (Stage 1.3). If either fails, everything built after it is untrustworthy — fix before continuing.
- For each checklist item, the referenced **table** (`schema.md`), **architecture section**, and **module** (`module-list.md`) are your spec. Read all three before writing code.
- When you finish a stage, **write/extend the tests named in its Test Gate**, run them, and report pass/fail per item. Don't self-declare a gate green without the tests.

---

## Final vs draft (critical)
- **Tables 1–23 + 4a (`RefreshToken`) + 4b (`AuthToken`) (Phase 0 & 1) are FINAL** — build them as written in `schema.md`.
- **Tables 24–54 + 30a/30b + 36a (Phase 2–4 + cross-cutting) are DRAFT** — connections and module ownership are correct, but **redesign the exact fields when you build that module.** Do not treat draft field lists as final. Confirm the field design with the user before building a draft table.

---

## Coding conventions
- **Stack:** Node/Express + TypeScript (strict) + Prisma + MySQL + Redis (cache + BullMQ) + Socket.IO. Web: React/Tailwind/shadcn. Mobile: React Native/NativeWind. Object storage: S3-compatible.
- **Module shape:** `routes → controller → service → repository`. Controllers do HTTP only. **Services hold business logic and are the only layer that calls repositories.** Repositories wrap Prisma. Cross-module calls are service-to-service — never reach into another module's repository. (`architecture.md` §2)
- **IDs:** `cuid()` strings.
- **Every tenant-owned table has `tenantId`** (indexed), even when reachable through a parent — this keeps isolation a single column check.
- **Actor/log references use a plain `...Id` column**, not a `User` relation (e.g. `createdById`, `uploadedById`).
- **Loose pointer** (`sourceType` + `sourceId`, no FK) is the pattern for the logbook, audit log, alerts, and AI jobs — anything that references "could be any table."
- **Validation:** Zod at the boundary; reject unknown fields.
- **Response shape:** `{ data, meta }` on success, `{ error: { code, message } }` on failure.
- **Pagination:** cursor-based for timelines/lists; never load big JSON blobs (`fieldValues`, `payload`) on list endpoints.
- **No raw SQL** unless through the tenant-asserting wrapper. Prisma parameterizes by default — never string-build queries.
- **Money** is stored in minor units as integers (no floats).
- **Slow work** (reports, notifications, AI, purges) is always a BullMQ job, never inline. Jobs are idempotent, carry `tenantId`, and re-establish tenant context.
- **No browser storage** (localStorage/sessionStorage) assumptions in app state where it matters; shared state lives in MySQL/Redis/storage.
- **No premature infra:** modular monolith, not microservices. No Kubernetes. No DB-per-tenant. These are future seams, not今-work.

---

## Security defaults (apply without being asked)
- argon2id password hashing; lockout/backoff on repeated failures.
- Access token ~15 min; refresh tokens live in **`RefreshToken`** (one row per issued token) with rotation + reuse-detection (re-presenting an already-`usedAt` token revokes the session family). Invites/resets use single-use **`AuthToken`**.
- **Tenant isolation fails closed; the only exempt models are `Plan` and `SharedIntelligenceEntry`** — the leak suite asserts this allowlist is exactly those two.
- `helmet` security headers; TLS assumed everywhere; secrets from a manager, never committed.
- Evidence/generated files: object storage, **signed URLs only**, never public; log every access (`EvidenceAccessLog`). **Mint a signed URL only when `MediaAsset.scanStatus = CLEAN`.**
- Uploads: validate MIME/size, malware-scan (`PENDING → CLEAN/INFECTED`) before serveable (mandatory for the public guest form). Anonymous uploads use `uploaderType=GUEST`, null `uploadedById`.
- **Public guest form context (B1):** the link carries a signed token (`GuestFormLink`), not the tenant slug; resolving it sets a restricted public context that can only create `GuestReport` + a `GUEST` `MediaAsset`.
- Rate limiting in Redis (shared across instances); strict on auth, very strict on the public guest form (+ CAPTCHA).
- **Authorization (B8):** `HOTEL_ADMIN`/`SUPER_ADMIN` tenant-wide; `SECURITY_MANAGER`/`SUPERVISOR` restricted to `UserPropertyAccess`; empty set for a scoped role = no access. `SUPER_ADMIN` is tenant-top, not platform staff (B6). Default-deny on routes with no policy.

---

## Product rules that are easy to get wrong (from the spec)
- **Every incident is filed through a catalog `ReportType`** — there is no "basic incident" screen.
- **Duplicate handling:** soft-delete the duplicate (`deletedAt` + `duplicateOfId`). The "Duplicate" tag is **derived at read time** from those fields — there is **no stored `isDuplicate`** and you must **never mutate a written `LogbookEntry`** (append-only). Don't hard-delete.
- **Logbook summary is point-in-time** — editing the source record must NOT rewrite the historical entry.
- **MediaAsset is polymorphic** (`ownerType`/`ownerId`) — incident evidence, guest-report photos, and lost-&-found proof all use it; there's no per-module relation. Fetch incident media via `where ownerType="Incident", ownerId=…`.
- **Patrol is software-only:** `PatrolLog.performedById` is the guard who did the round; `loggedById` is the operator who typed it in (guards don't use the app). "Overdue" = no log within `PatrolRoute.expectedIntervalMinutes` (add an operating window when you build module 14 — C2).
- **Manage-by-exception** monitors operational performance (unacknowledged alerts, configured SLA timers, overdue patrols) — **never guests**. "SLA" is config rows in `ExceptionRule`, not a separate module.
- **Guest safety reporting is anonymous by design** — never require verification (it would block real emergencies). The optional room-number field is a soft spam-deterrent, never required, never blocking.
- **CRITICAL notifications bypass quiet hours / per-channel disables** (C5) — a "mute" must never silence a life-safety alert.
- **Lone-worker/duress (module 16) does not exist** — removed; don't build it.
- **AI never commits to an official record** — it drafts; a human approves. Numbers are computed in code; AI only writes prose around them.
- **Outbox exactly-once** is enforced by `dedupeKey` on `LogbookEntry`/`Notification` + `nextAttemptAt`/`SKIP LOCKED` claiming; the outbox table (not BullMQ) owns relay retry/DLQ.
- **Tenant offboarding is export-then-purge** (A8), not a raw `DELETE FROM Tenant` — that would wipe append-only audit/evidence logs.

---

## Open items to resolve with the user before the affected work
- ✅ *(resolved)* `MediaAsset` generalized (`ownerType`/`ownerId`) — done in v1.1.
- **Encrypt `PmsConnection.config`** secrets (secrets manager) before PMS integration (table 42).
- **`SharedIntelligenceEntry` (table 46)** is the one deliberate exception to tenant-scoping (in the allowlist). Get explicit confirmation and extra review before building it.
- **Incident-response SLAs?** If yes, add `acknowledgedAt`/`respondedAt` to FINAL `Incident` **now** (C3) — confirm with the user before locking.
- **Platform support model (B6):** confirm audited impersonation vs. no platform access.
- **Right-to-erasure index (B4)** and **legal-hold exemption (B5):** design when building retention/privacy ops.

---

## When you're unsure
- If a checklist item, a schema field, and a module description disagree, **stop and ask** — that's a sync hole, not something to guess through.
- If a task seems to require violating a non-negotiable, **flag it** instead of finding a workaround.
- Prefer the smallest correct implementation that passes the stage's Test Gate. This is an MVP — build the MVP, not the roadmap.

---

## Definition of done (per stage)
A stage is done when: every checklist box is implemented, the stage's **Test Gate tests are written and passing**, the **leak suite is still green**, and you've reported results per gate item. Only then move to the next stage.
