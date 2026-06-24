# Review Resolutions — what changed and why

Applies the Claude Code review (`review-holes-and-questions.md`) to the handoff package. Each entry says what changed and in which files. **Decisions** (where the review offered options) are marked **DECISION** with the choice made — override any of these and tell me, they're not one-way doors.

Files touched: `schema.md`, `architecture.md`, `module-list.md`, `checklist.md`, `instructions.md`.

---

## FINAL-table schema changes (expensive to retrofit — done now)

**A1 — Refresh-token reuse detection.** Added a **`RefreshToken`** child table (table 4a): one row per issued token (`tokenHash @unique`, `replacedById`, `usedAt`, `revokedAt`, `expiresAt`). `Session.refreshTokenHash` removed — a session now owns many refresh tokens over its life. Reuse of an already-rotated token (`usedAt` set) ⇒ revoke the whole session family. The Stage-0 gate is now actually meetable.

**A2 — Evidence scan state.** Added **`scanStatus`** (`MediaScanStatus { PENDING CLEAN INFECTED }`, default `PENDING`) + `scannedAt` to `MediaAsset`. Signed-URL minting is gated on `scanStatus = CLEAN`.

**A3 — Anonymous uploads + MediaAsset generalization (resolved the open item too).**
- `MediaAsset.uploadedById` is now **nullable**, plus `uploaderType` (`UploaderType { USER GUEST SYSTEM }`).
- **DECISION:** made `MediaAsset` **fully polymorphic** — replaced `incidentId` + the `Incident.media` relation with a loose `ownerType`/`ownerId` pointer (consistent with how the logbook/audit/alerts already work). This closes the previously-flagged "generalize MediaAsset for Lost & Found" open item in the same change. *Trade-off: no Prisma `include: { media }` on incidents — the repository fetches media with a scoped `where ownerType="Incident", ownerId=…` query. If you'd rather keep a formal incident relation and add `ownerType/ownerId` only as additive columns, say so.*

**A7 — Invite / password-reset tokens.** Added **`AuthToken`** table (table 4b): `tokenHash @unique`, `userId`, `purpose` (`AuthTokenPurpose { INVITE PASSWORD_RESET }`), `expiresAt`, `usedAt`. Auth can't ship without this; it was missing entirely.

**A4 — Outbox idempotency (exactly-once by design, not luck).** Added **`dedupeKey String? @unique`** to both `LogbookEntry` and `Notification`. The relay sets it deterministically (e.g. `outboxEventId` or `sourceType:sourceId:created`) for system-generated rows; manual entries leave it null (MySQL allows many NULLs in a unique index, so manual rows aren't constrained). A re-run of the relay can't double-insert.

**A5 — Outbox backoff + safe polling + retry ownership.** Added **`nextAttemptAt DateTime @default(now())`** and **`lockedUntil DateTime?`** to `OutboxEvent`. **DECISION:** the **outbox table owns relay retry/DLQ**, not BullMQ — the relay claims rows with `WHERE status=PENDING AND nextAttemptAt<=now() ... FOR UPDATE SKIP LOCKED`, increments `attempts`, sets `nextAttemptAt` with backoff, and a row that exhausts retries becomes `FAILED` (= the dead-letter state). BullMQ is used only for the *downstream* jobs the relay dispatches (notifications, reports), not for outbox-relay retry. This removes the "two stacked retry mechanisms" ambiguity.

---

## Decisions on contradictions (marked — override freely)

**A6 — Duplicate tagging vs append-only. DECISION: derive at read time.** Dropped the stored `LogbookEntry.isDuplicate` column. The "Duplicate" tag is computed at query time from the source incident's `deletedAt`/`duplicateOfId`. This keeps append-only truly inviolate (no flipping a flag on a written row). *Alternative was to exempt `isDuplicate` as the one permitted mutation — rejected to keep the rule clean.*

**A8 — Tenant offboarding vs append-only/tombstone. DECISION: export-then-purge, not silent cascade.** Removed the "offboarding a hotel is a single delete" line. Offboarding is now a documented controlled operation: export the tenant's data, retain audit/evidence logs per the retention policy + any contractual hold, then purge. `onDelete: Cascade` stays for referential integrity within an active tenant, but a deliberate offboarding flow — not a raw `DELETE FROM Tenant` — is the path. Documented in `architecture.md` §13.

**A9 — `zoneId` integrity. DECISION: real FK + service validation.** `Incident.zoneId` and `ShiftAssignment.zoneId` are now formal `zone Zone? @relation`s (Zone gained the back-relations). The service must validate `zone.propertyId === record.propertyId` on write. Removes the silent "zone from another property" hole. (Draft `AccessLog.zoneId` likewise when built.)

**B1 — Guest-form tenant context. DECISION: signed link token + restricted public context.** The public link carries a **signed/opaque token**, not the tenant slug. Resolving it sets a restricted "public" context that can **only** create `GuestReport` + a `GUEST`-uploaded `MediaAsset` — and the fail-closed filter is satisfied because the token resolution sets `{ tenantId, propertyId }`. Added a draft **`GuestFormLink`** table (table 36a) so links are revocable/expirable. Documented in `architecture.md` §4.5.

**B6 — `SUPER_ADMIN` / platform support. DECISION: SUPER_ADMIN is tenant-top; support is a separate audited path.** `SUPER_ADMIN` is the tenant's highest role. Platform staff do **not** get a tenant role that bypasses the filter; any support access is a distinct, explicitly-audited impersonation path (logged to `AuditLog` with an `impersonatedBy` actor) — or, if you prefer, "support never sees tenant data." Documented in `architecture.md` §4.2. *Tell me which: audited impersonation, or no-access.*

**B8 — Property-scope rule. DECISION (stated explicitly now):** `HOTEL_ADMIN` and `SUPER_ADMIN` are **tenant-wide** (ignore `UserPropertyAccess`); `SECURITY_MANAGER` and `SUPERVISOR` are **restricted to their `UserPropertyAccess` rows**; an empty access set for a scoped role = **no property access** (not all). Documented in `architecture.md` §4.2.

---

## Other fixes applied

**A10 — `AnalyticsRollup` NULL-property dedupe (draft).** `propertyId` is now non-null with a sentinel default `"_ALL"` for tenant-wide rollups, so the unique constraint actually dedupes re-rolled buckets.

**A11 — Tenant-exempt allowlist (security-critical).** Documented the fail-closed filter's exempt-model allowlist = **{ `Plan`, `SharedIntelligenceEntry` }** (the only models without a normal `tenantId`). Adding to it requires review. The Stage-0 leak suite must assert the exempt set is exactly this and nothing else. In `architecture.md` §4.3, `instructions.md`, and the Stage-0 gate in `checklist.md`.

**D1 — Emergency sync hole fixed.** Added draft `EmergencyPlaybook` (30a) + `EmergencyEvent` (30b) so the previously-orphaned `EmergencyKind`/`EmergencyStatus` enums have tables. Module index updated.

**D3 (minor) — `Tenant.status` enum.** Changed `Tenant.status` from a bare string to `TenantStatus { ACTIVE SUSPENDED CANCELED }` for consistency and safe feature-gating.

---

## Patched Test Gates (`checklist.md`)
- **Stage 0:** refresh-reuse gate now references the `RefreshToken` table; added an **allowlist-lock** gate item (A11); added invite/reset token build step (A7).
- **Stage 1.3 (outbox, absolute gate):** now references the `dedupeKey` idempotency and `nextAttemptAt` backoff; the exactly-once crash test is meetable.
- **Stage 1.5:** added `scanStatus` gating step (signed URL only when CLEAN); anonymous-upload path (`uploaderType=GUEST`, null uploader).
- **Stage 1.6:** duplicate tag is **read-time derived** (no stored flag); the E2E timeline assertion now **waits for relay processing** (fixes the C6 race the gate had).
- **Stage 0/1:** zone-FK validation step (A9).

---

## Deferred but recorded (design-now, build-later — not applied as schema yet)
These were correctly raised; they're noted in `instructions.md` "open items" and at their module in `checklist.md`, to design when you reach them:
- **B4** PII registry / subject entity for right-to-erasure.
- **B5** legal-hold / open-incident exemption on the purge job (recommend a `legalHold` flag on `Incident`/`MediaAsset` when you build retention).
- **C1** required-posts baseline for coverage-gap (or descope "unassigned post").
- **C2** patrol operating window/anchor on `PatrolRoute`.
- **C3** incident SLA timestamps on `Incident` — **decide before it's locked**: if incident-response SLAs are real, add `acknowledgedAt`/`respondedAt` to the FINAL `Incident` now. *Flagged for your call.*
- **C4** dynamic `fieldValues` validator (compile `ReportTypeVersion.schema` → Ajv/Zod at submit).
- **C5** CRITICAL notifications bypass quiet hours / per-channel disable.
- **C7/C8/C9** open-row uniqueness, seat-counting excludes GUARD, no incident assigned to a GUARD — all service-layer guards.
- **A12** `correctsId` self-link on `LogbookEntry`/`AuditLog` for corrections.
- **B2/B3/B7/B9** revocation-latency acceptance, web token/CSRF posture, MFA seam, socket token re-auth.
- **D2** scalar-only draft tables need explicit inclusion in the offboarding flow.

---

## Still-open items (unchanged, need your input or later work)
- **PmsConnection.config** secrets must be encrypted / in a secrets manager before PMS (table 42).
- **B6** confirm: audited support impersonation, or no platform access at all.
- **C3** confirm whether incident-response SLAs are in scope (touches FINAL `Incident`).
