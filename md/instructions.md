# Instructions for Claude Code — Hotel Security Operations Platform

Read this first. It tells you how to use the other four files and the rules that apply to **every** task. The package:

- **`module-list.md`** — what the product does (features, by phase).
- **`schema.md`** — the data model (54 tables; 1–23 final, 24–54 draft).
- **`architecture.md`** — how it's built (patterns, security, the non-negotiables).
- **`checklist.md`** — the build order, with a **Test Gate** after every stage.
- **`instructions.md`** — this file.

---

## What we're building (one paragraph)
A multi-tenant, **software-only** hotel security-operations SaaS. Users are the control room, supervisors, managers, and owners. **Line guards never use the system** — they report by radio and the control room logs for them. There is **no hardware** anywhere (no patrol devices, NFC tags, panic buttons, CCTV analytics). The product digitizes a control desk: logbook, incidents, patrols, people/assets, then analytics and AI on top — on a multi-tenant foundation where tenant isolation is the #1 control.

---

## The 4 non-negotiables (never violate these)
1. **Tenant isolation, fail-closed.** All tenant data goes through the tenant-scoped Prisma client, which injects `tenantId` from request/worker context. **If context is missing, throw — never run an unscoped query.** Handle the three gaps explicitly: nested writes (set `tenantId`), raw SQL (use the tenant-asserting wrapper), bulk creates (map the array). See `architecture.md` §4.3.
2. **Transactional outbox for reliable events.** When a state change must trigger downstream effects (notifications, logbook entries), write an `OutboxEvent` **in the same transaction** as the change; a relay worker delivers it. Never "save then separately enqueue." See `architecture.md` §6.
3. **Append-only logs.** Never update or delete `AuditLog` or `LogbookEntry` rows. Corrections are new rows. Server time is authoritative. See `architecture.md` §4.9.
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
- **Tables 1–23 (Phase 0 & 1) are FINAL** — build them as written in `schema.md`.
- **Tables 24–54 (Phase 2–4 + cross-cutting) are DRAFT** — the connections and module ownership are correct, but **redesign the exact fields when you actually build that module.** Do not treat draft field lists as final. Confirm the field design with the user before building a draft table.

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
- Access token ~15 min; refresh token opaque + hashed in `Session`; rotation with reuse-detection.
- `helmet` security headers; TLS assumed everywhere; secrets from a manager, never committed.
- Evidence and generated files: object storage, **signed URLs only**, never public; log every access (`EvidenceAccessLog`).
- Uploads: validate MIME/size, malware-scan before "usable" (mandatory for the public guest form).
- Rate limiting in Redis (shared across instances); strict on auth, very strict on the public guest form (+ CAPTCHA).
- Default-deny authorization: a route without an explicit policy is rejected.

---

## Product rules that are easy to get wrong (from the spec)
- **Every incident is filed through a catalog `ReportType`** — there is no "basic incident" screen.
- **Duplicate handling:** soft-delete the duplicate (`deletedAt` + `duplicateOfId`); it stays on the timeline tagged via `LogbookEntry.isDuplicate`. Don't hard-delete.
- **Logbook summary is point-in-time** — editing the source record must NOT rewrite the historical entry.
- **Patrol is software-only:** `PatrolLog.performedById` is the guard who did the round; `loggedById` is the operator who typed it in (guards don't use the app). "Overdue" = no log within `PatrolRoute.expectedIntervalMinutes`.
- **Manage-by-exception** monitors operational performance (unacknowledged alerts, configured SLA timers, overdue patrols) — **never guests**. "SLA" is config rows in `ExceptionRule`, not a separate module.
- **Guest safety reporting is anonymous by design** — never require verification (it would block real emergencies). The optional room-number field is a soft spam-deterrent, never required, never blocking.
- **Lone-worker/duress (module 16) does not exist** — removed; don't build it.
- **AI never commits to an official record** — it drafts; a human approves. Numbers are computed in code; AI only writes prose around them.

---

## Open items to resolve with the user before the affected work
- **Generalize `MediaAsset`** (add `ownerType`/`ownerId`) before building Lost & Found (table 29) so non-incident proof photos can attach.
- **Encrypt `PmsConnection.config`** secrets (secrets manager) before PMS integration (table 42).
- **`SharedIntelligenceEntry` (table 46)** is the one deliberate exception to tenant-scoping (keyed by `originTenantId`). Get explicit confirmation and extra review before building it.

---

## When you're unsure
- If a checklist item, a schema field, and a module description disagree, **stop and ask** — that's a sync hole, not something to guess through.
- If a task seems to require violating a non-negotiable, **flag it** instead of finding a workaround.
- Prefer the smallest correct implementation that passes the stage's Test Gate. This is an MVP — build the MVP, not the roadmap.

---

## Definition of done (per stage)
A stage is done when: every checklist box is implemented, the stage's **Test Gate tests are written and passing**, the **leak suite is still green**, and you've reported results per gate item. Only then move to the next stage.
