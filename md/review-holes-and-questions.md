# Review — Holes & Clarifying Questions

**Reviewer stance:** senior engineer, security + scale focus. Read order: `instructions.md` → `architecture.md` → `module-list.md` → `checklist.md` → `schema.md`.

**Overall:** the plan is strong and unusually coherent — fail-closed tenant filter, transactional outbox, append-only logs, guards-as-subjects, and the final/draft split are the right calls, and the cross-file referencing is tight. The holes below are not "the plan is wrong"; they're **specific gaps that will bite during the build**, weighted toward the FINAL tables (1–23) and the stated Test Gates, because that's where "draft, will change later" is not an excuse.

Severity:
- 🔴 **Blocker** — contradicts a stated gate, or a defect in a FINAL table / the security core. Fix before/while building that piece.
- 🟠 **Important** — real gap that will force a schema or design change if discovered late.
- 🟡 **Minor / later** — mostly draft-scope or polish; note it so it isn't forgotten.

---

## A. Blockers — FINAL scope or a stated gate can't be met as designed

### A1. 🔴 Refresh-token reuse detection is impossible as modeled
**Where:** `Session` (table 4); gate "Refresh-token reuse revokes the session" (Stage 0 gate, `checklist.md`); `architecture.md` §4.1.
`Session` holds a single `refreshTokenHash`. On rotation you "swap the token and kill the old." But to *detect reuse of a stolen old token* you must still recognize that old token after rotation — a single-column current-hash can't tell "this is a known, already-rotated token (→ theft → revoke family)" apart from "this is garbage (→ just 401)." As written, reuse-detection degrades to a plain invalid-token rejection, so the gate fails.
**Fix (MVP-minimal):** add token lineage — either a `RefreshToken` child table (one row per issued token: `hash @unique`, `replacedById`, `usedAt`, `revokedAt`) or, cheaper, keep `Session.refreshTokenHash` + a `previousTokenHash`/`generation` and a per-session "family" revoke. The child-table version is the standard rotation-with-reuse-detection shape and is what the gate is really asking for.

### A2. 🔴 No scan-state on `MediaAsset` — "malware-scan before usable" can't be represented
**Where:** `MediaAsset` (table 15, FINAL); `architecture.md` §4.6; `checklist.md` 1.5 ("queued malware scan before 'usable'").
The table has no `scanStatus` (PENDING/CLEAN/INFECTED) or `quarantinedAt`. There is literally no column that distinguishes "uploaded but not yet scanned" from "safe to serve." Signed-URL issuance is supposed to be gated on scan status — gated on what field?
**Fix:** add `scanStatus` enum (+ optional `scannedAt`) to `MediaAsset`. Signed-URL minting checks `scanStatus = CLEAN`. This is a FINAL table, so it needs to land now, not in the Phase-2 generalization pass.

### A3. 🔴 `MediaAsset.uploadedById` is non-nullable, but anonymous guests upload photos
**Where:** `MediaAsset.uploadedById String` (table 15, FINAL); `GuestReport.photoMediaId` (table 36); `module-list.md` 17 ("anonymous by design").
The public guest form is unauthenticated — there is no user id — yet `uploadedById` is required. Same tension for any future non-user upload path. Because table 15 is FINAL, this constraint is baked in before the module that breaks it is built.
**Fix:** make `uploadedById` nullable, or add an `uploaderType` discriminator (USER/GUEST/SYSTEM). Pairs naturally with the already-flagged `ownerType`/`ownerId` generalization — do both in one change.

### A4. 🔴 Outbox has no idempotency key — retries can duplicate downstream effects
**Where:** `OutboxEvent` (table 11); Stage 1.3 gate ("delivers exactly once (idempotent)"); §6.
The design is correctly at-least-once delivery, which **requires idempotent consumers** — but nothing in the schema enforces it. If the relay crashes mid-fan-out and re-runs, `incident.created` can write a **second** `LogbookEntry` and a **second** `Notification`. `LogbookEntry` has no unique constraint on `(sourceType, sourceId)`; `Notification` has no idempotency key. So "exactly once" is asserted by the gate but not achievable by the data model.
**Fix:** give each side-effect a deterministic dedup key. Simplest: unique `(tenantId, type, sourceType, sourceId)` on `LogbookEntry` for system-generated entries, and an `idempotencyKey @unique` on `Notification` derived from `outboxEventId + channel + recipient`. Alternatively a small `ProcessedEffect(outboxEventId, effectKey)` ledger. Without one of these, the crash test passes by luck, not by design.

### A5. 🔴 Outbox can't schedule backoff or be safely polled by >1 relay
**Where:** `OutboxEvent` (table 11); §6 ("limited retries + backoff + dead-letter").
Columns are `status`, `attempts`, `createdAt`, `processedAt`. There's no `nextAttemptAt`/`availableAt` (so "retry with backoff" has nowhere to store *when* the next try is due — a failed row is either PENDING-immediately or stuck), and no `lockedUntil`/`claimedAt` (so two relay workers will both grab the same PENDING row). MVP runs one relay, which hides the second problem, but the backoff column is needed even with one worker. Also: the relationship between `OutboxStatus.FAILED` and the BullMQ "dead-letter queue" is ambiguous — are there two retry mechanisms (DB `attempts` *and* BullMQ retries) stacked on each other? Pick one as the source of truth.
**Fix:** add `nextAttemptAt DateTime` (and ideally `lockedUntil`); claim rows with `... WHERE status=PENDING AND nextAttemptAt<=now() ... FOR UPDATE SKIP LOCKED`. Document whether the outbox table or BullMQ owns retry/DLQ — not both.

### A6. 🔴 Duplicate-handling contradicts append-only / point-in-time logbook
**Where:** `LogbookEntry.isDuplicate` (table 22); `Incident.duplicateOfId/deletedAt` (table 14); non-negotiable #3 (append-only) + product rule "summary is point-in-time."
Flow: an incident gets a logbook entry at creation; *later* it's marked a duplicate. The "Duplicate" tag must now appear on the **existing** timeline row — i.e. you must flip `isDuplicate` on an already-written `LogbookEntry`. But the logbook is declared append-only and "editing the source must NOT rewrite the historical entry." Flipping `isDuplicate` is exactly such a mutation. So two non-negotiables collide on the one flow the spec calls out as important.
**Fix / decision needed:** either (a) explicitly exempt `isDuplicate` as the *one* permitted mutation (define append-only as "summary/occurredAt immutable; status flags may change"), or (b) render the duplicate tag by **reading the source incident's `deletedAt/duplicateOfId` at query time** instead of denormalizing it onto the entry (then `isDuplicate` shouldn't exist as a stored column). Pick one; today the schema implies (a) while the rules imply (b).

### A7. 🔴 No invite-accept / password-reset / set-password token mechanism
**Where:** `User.status INVITED` (table 2); `Session` (table 4); auth section. Nothing else.
`INVITED → ACTIVE` implies an invite link the user clicks to set a password. There is no `InviteToken`/`PasswordResetToken` table or token field anywhere. Password reset — a baseline auth feature — has **zero** schema support. You cannot ship auth without these.
**Fix:** add a single-purpose token table (`hash @unique`, `userId`, `purpose` [INVITE/RESET], `expiresAt`, `usedAt`) or equivalent. Small, but it's missing entirely from a FINAL-stage concern.

### A8. 🔴 Tenant hard-delete cascade wipes audit & evidence-access logs
**Where:** `onDelete: Cascade` on `AuditLog`, `EvidenceAccessLog`, etc.; `instructions.md`/schema "offboarding a hotel is a single delete"; vs non-negotiable #3 (append-only) and §13 "deletion = anonymize/tombstone, **not** hard delete."
The schema makes a tenant delete cascade-destroy every child including `AuditLog` and `EvidenceAccessLog`. That directly contradicts (a) append-only immutability and (b) the RA 10173 stance that deletion is tombstone-not-purge. A regulator asking "prove what happened to tenant X's data" after offboarding gets nothing.
**Decision needed:** is tenant offboarding a true hard delete (then say so, and reconcile with the tombstone rule + any contractual retention), or a tenant-level tombstone/export-then-purge? Right now two parts of the spec assume opposite answers.

### A9. 🔴 `zoneId` is a bare scalar with no FK — no same-property/tenant validation
**Where:** `Incident.zoneId String?` (table 14) — declared as a scalar with **no** `zone Zone?` relation, while `propertyId` *is* a real FK. Same pattern on `ShiftAssignment.zoneId`, `AccessLog.zoneId`.
Inconsistent: property is DB-enforced, zone is not. Nothing stops attaching a `zoneId` that belongs to a different property — or, within a multi-property tenant, a stale/foreign zone — to an incident. It's not a cross-*tenant* leak (the code filter still scopes), but it's a silent data-integrity hole on a FINAL table, and analytics "BY_ZONE" inherits it.
**Decision/fix:** either make `zoneId` a real FK (and validate property match in the service), or consciously declare it a loose pointer and validate `zone.propertyId === incident.propertyId` in code. State which — the current half-and-half is almost certainly unintended.

### A10. 🔴 `AnalyticsRollup` uniqueness breaks on tenant-wide (NULL property) buckets
**Where:** `AnalyticsRollup @@unique([tenantId, propertyId, dimension, metric, bucketStart])` with `propertyId String?` (table 37).
MySQL treats `NULL` as distinct in a unique index, so multiple rows with `propertyId = NULL` are allowed. The whole "idempotent re-roll over a trailing window" correctness story (§9) depends on this unique constraint deduping a re-rolled bucket — but for **tenant-wide** rollups (`propertyId` NULL) it silently won't, so re-rolls accumulate duplicate buckets and double-count. This is draft, but it's the linchpin of the analytics-correctness narrative, so flag it now.
**Fix:** use a sentinel (`propertyId = "_ALL"`) instead of NULL for tenant-wide rollups, or a generated non-null discriminator column in the unique key.

### A11. 🔴 Fail-closed filter needs an explicit tenant-exempt allowlist
**Where:** §4.3 ("injects `tenantId` into **every** read/write"); `Plan` (table 47, global, **no** `tenantId`); `SharedIntelligenceEntry` (table 46, keyed by `originTenantId`).
A filter that blindly injects `tenantId` will throw or mis-query on models that legitimately have no `tenantId` (`Plan`) or use a different key (`SharedIntelligenceEntry`). So the extension needs a hardcoded **allowlist of tenant-exempt models** — and that allowlist is itself a security-critical surface (anything wrongly added becomes a cross-tenant leak). It's not mentioned anywhere, and the leak suite must explicitly assert the allowlist is exactly {Plan, SharedIntelligenceEntry, migrations…} and nothing else.
**Fix:** specify the exempt-model list in the kernel, make adding to it require review, and add a leak-suite test that fails if an unexpected model is exempt.

### A12. 🟠 "Corrections are new rows" — but nothing links a correction to its original
**Where:** non-negotiable #3; `LogbookEntry` (22), `AuditLog` (23).
The rule says corrections are appended as new rows, but neither table has a `correctsId`/`supersedesId`. A reader sees two unrelated rows and can't tell that the second corrects the first, nor reconstruct "current truth."
**Fix:** add an optional self-link (`correctsEntryId`) so a correction references what it amends. Cheap; makes the append-only model actually usable for investigations.

---

## B. Security holes

### B1. 🔴 Public guest form: how is tenant context established for an unauthenticated, fail-closed request?
**Where:** §4.1/§4.5; `GuestReport` (table 36); `module-list.md` 17.
Every write goes through a filter that **throws without tenant context**, but the guest form has no session. Something must set `{ tenantId, propertyId }` for that request — presumably from the link. The spec says "the link's tenant scope" but never defines the link. If it's the tenant `slug` (which is globally unique and guessable), an attacker can enumerate tenants/properties and spam any hotel's intake, or post into the wrong tenant. There's also no table modeling the public link.
**Fix/decision:** the public link must carry a **signed, opaque token** (HMAC over tenant+property, optionally expiring/rotatable), resolved server-side to set a restricted "public" context that can *only* create `GuestReport` + `MediaAsset`. Consider a `GuestFormLink` row so links are revocable. Specify who/what sets context on this one unauthenticated write path — it's the highest-risk surface in the system.

### B2. 🟠 Session revocation latency = access-token TTL (+ heartbeat), not immediate
**Where:** §4.1 ("logs out on next heartbeat"; access token "verified with no DB hit"); §11 (instant kill is "genuinely later").
Revoking a session does **not** invalidate the already-issued 15-min access token (it's verified statelessly) and only logs out on the next heartbeat. So a revoked/compromised user keeps access for up to ~15 min + heartbeat interval. This may be an acceptable MVP tradeoff — but it should be stated as an accepted risk, especially for "revoke a lost login" which users will *expect* to be immediate. Confirm it's acceptable, and that "revoke session" UX copy doesn't promise instant.

### B3. 🟠 Token storage / CSRF posture is undefined
**Where:** `instructions.md` "No browser storage assumptions"; §4.1.
If the SPA can't use localStorage/sessionStorage, where does it hold the access token (memory only → lost on refresh) and the refresh token? If the refresh token rides in an httpOnly cookie, you now need CSRF protection on the refresh/auth endpoints; if it's in a header, you need a storage answer. The CSRF/token-transport model isn't specified and shapes the whole web-auth implementation.
**Decision needed:** access token in memory + refresh token in httpOnly+SameSite cookie (then add CSRF on state-changing routes), or bearer-header everywhere (then specify storage). Pick one explicitly.

### B4. 🟠 Right-to-erasure has no index of where a person's PII lives
**Where:** `DeletionRequest.subjectRef` (52), `ConsentRecord.subjectRef` (53); free-text PII in `WatchlistEntry.name` (31), `Visitor.name` (24), `GuestReport.description` (36), `LostFoundItem.claimantName/finderName` (29).
"Tombstone on request" is the right model, but a `subjectRef` string can't *find* a person whose name is scattered as free text across half a dozen tables with no person entity and no link. Honoring a deletion request becomes a manual, error-prone grep — and missing one row is a compliance failure.
**Fix (later, but design now):** decide whether subjects get a real entity/id that PII rows reference, or maintain a documented registry of "tables/fields that hold subject PII" that the tombstone job walks. RA 10173 makes this non-optional eventually.

### B5. 🟠 Retention auto-purge has no legal-hold / open-investigation exemption
**Where:** `RetentionPolicy` (51); §13 (daily purge "deletes the files too").
A horizon-based purge will happily delete evidence for an **open incident**, an active insurance claim, or data under a police/legal hold. There's no `legalHold`/exemption flag and no "don't purge if referenced by an open incident" rule.
**Fix:** add a hold flag (on `Incident`/`MediaAsset`) and make the purge job skip held/open-referenced records. Cheap insurance against deleting the exact evidence the product exists to protect.

### B6. 🟠 Platform-operator / support / impersonation access is undefined; `SUPER_ADMIN` is ambiguous
**Where:** `Role { … SUPER_ADMIN }` (enum); `module-list.md` 0.2 ("supervisor → … → super-admin" as a per-tenant hierarchy).
Is `SUPER_ADMIN` the tenant's top admin, or your platform staff? The module list implies tenant-top — which leaves **no defined access model for your own support/ops** to help a tenant (and any such access fundamentally fights the fail-closed filter). If support impersonation exists, it must be a distinct, heavily-audited path, not a role that quietly bypasses tenant scoping.
**Decision needed:** define the platform-operator model (or explicitly: "none — support never sees tenant data"), and if impersonation exists, how it sets context and how it's audited.

### B7. 🟡 No MFA anywhere
For a product whose selling point is security/evidence integrity, no optional TOTP/MFA for admin/manager logins is a notable omission buyers will ask about. Likely out of MVP scope — but make that a conscious decision, not an oversight, and leave a seam (it's purely additive to auth).

### B8. 🟠 Property-scope enforcement logic is unspecified (empty access = all, or none?)
**Where:** §4.2 ("two locks"); `UserPropertyAccess` (table 3).
If a `HOTEL_ADMIN` has **no** `UserPropertyAccess` rows, do they see all properties (tenant-wide) or none? The "always check property" framing implies none, which would lock admins out; intuition says admins are tenant-wide and only lower roles are property-scoped. The rule for *when* `UserPropertyAccess` is enforced vs bypassed (by role) is the actual authorization logic and isn't written down.
**Fix:** state it: e.g. `HOTEL_ADMIN`/`SUPER_ADMIN` are tenant-wide; `SECURITY_MANAGER`/`SUPERVISOR` are restricted to their `UserPropertyAccess` rows; empty set = no access for the scoped roles.

### B9. 🟡 Socket.IO token lifecycle over long-lived connections
**Where:** §5 ("authenticated handshake").
The handshake presents the 15-min access token, but a dispatch screen stays open for hours. What happens when the token expires mid-connection — forced reconnect with a fresh token, in-band re-auth, or does the socket outlive its token (a hole)? Specify re-auth on the socket so a revoked/expired user doesn't keep receiving live alerts.

---

## C. Product-logic gaps

### C1. 🟠 Coverage-gap detection has no definition of *required* coverage
**Where:** `module-list.md` 0.2/3 ("coverage-gap detection (no-show, **unassigned post**)"); `Shift`/`ShiftAssignment` (17/18); Stage 1.7 gate.
"No-show" is detectable (assignment exists, no clock-in). But "**unassigned post**" requires knowing which posts/zones *must* be staffed for a shift — and there's no "required posts" baseline anywhere (`ShiftAssignment.zoneId` is optional and only describes what *is* assigned, never what *should* be). You can't detect a gap against an undefined target.
**Fix:** add a minimal "required posts per shift/property" config (even a count, or a list of zones), or drop "unassigned post" from the gate as out of MVP scope.

### C2. 🟠 Overdue-patrol detection needs an anchor/operating window, not just an interval
**Where:** `PatrolRoute.expectedIntervalMinutes` (20); module 14 "overdue patrols"; Stage 1.7 & Stage 3 gates.
"Every 120 min" from *when*? 24/7? If rounds are only expected 18:00–06:00, a bare interval flags the whole daytime as overdue. There's no start anchor, no active days/hours, no "first expected at."
**Fix:** add an operating window / anchor (or active-hours) to `PatrolRoute`, or define the overdue rule precisely (e.g. "overdue = now − last log > interval, only during the route's active window").

### C3. 🟠 `ExceptionRule` "incident_sla" can't be computed — `Incident` lacks the timestamps
**Where:** `ExceptionRule.metric "incident_sla"` (34); `Incident` (14).
`Alert` has `acknowledgedAt`/`resolvedAt` for SLA math; `Incident` has only `status` + `closedAt` — no acknowledged/response timestamp. So an incident-response SLA breach is unmeasurable as modeled. (Draft table, but the metric is named explicitly, so the FINAL `Incident` may need an `acknowledgedAt`/`respondedAt` to support it later — decide now whether incident SLAs are a thing, since it touches a FINAL table.)

### C4. 🟠 Dynamic `fieldValues` validation engine is unspecified
**Where:** `Incident.fieldValues Json` validated against `ReportTypeVersion.schema Json` (13/14); Stage 1.5 ("validated against the pinned version").
Boundary validation is "Zod, reject unknown fields" — but Zod schemas are static, and report-type fields are dynamic per-version JSON. You need a runtime validator that compiles a version's JSON field-spec into a validator (Ajv, or a Zod-from-JSON builder). Not mentioned; it's a non-trivial, security-relevant piece (it's the validation boundary for arbitrary admin-defined forms).
**Fix:** name the approach (e.g. derive a validator from `ReportTypeVersion.schema` at submit time) so it isn't discovered mid-Stage-1.

### C5. 🟡 Quiet hours can suppress CRITICAL notifications
**Where:** `NotificationPreference.enabled` (9); §7; module 0.5 ("respects … quiet hours").
A boolean per channel + quiet hours, with no severity override, means a CRITICAL emergency notification can be silenced by a user's quiet-hours setting. For a security product that's dangerous.
**Fix:** define that CRITICAL/emergency bypasses quiet hours and per-channel disables (or always uses an always-on channel).

### C6. 🟡 Timeline is eventually consistent — the Stage-1 E2E gate races the relay
**Where:** logbook entry written by the async relay *after* the incident commits (§6, 1.6); Stage 1 E2E gate "logs an incident … **sees it on the timeline**."
The entry appears only once the relay processes the outbox row, so immediately after creating an incident the timeline may not show it yet (relay lag). Fine architecturally, but the UX and the E2E test must account for it (poll/optimistic insert), or the gate is flaky.
**Fix:** decide the UX (optimistic row vs "pending" state) and make the test wait for relay processing rather than asserting synchronously.

### C7. 🟡 Open-row patterns have no guard against multiple concurrent "open" rows (draft)
**Where:** `EquipmentAssignment`/`VisitorEntry`/`Badge` (28/25/26) — "currently out = `returnedAt`/`exitAt` IS NULL."
Nothing prevents two open assignments for the same item (double-issue a key, two open entries for one visitor). MySQL can't easily express "at most one row with NULL returnedAt per item." Note for when these are specced.
**Fix later:** enforce in the service inside a transaction, or use a status column + partial-uniqueness workaround.

### C8. 🟡 Guards likely inflate seat-based billing
**Where:** `Subscription.seats` (48); guards are `User` rows with `role GUARD`.
If seats are counted from `User` rows, non-login guard roster entries get billed as seats. Almost certainly not intended.
**Fix:** define seat = users with a non-GUARD role (or with a non-null `passwordHash`).

### C9. 🟡 Incidents can be assigned to a GUARD (a non-user)
**Where:** `Incident.assignedToId → User` (14).
Guards don't use the app, so assigning an incident to one is a dead end. Restrict assignee to non-GUARD roles in the service.

---

## D. Consistency / missing-artifact holes

### D1. 🔴 Emergency module (11): enums exist, **tables don't**
**Where:** enums `EmergencyKind`/`EmergencyStatus` defined (schema "Enums"); `module-list.md` 11 references `EmergencyPlaybook`, `EmergencyEvent` (draft); module index row 11 → "(draft)" with **no table numbers**; no models 30.x for them anywhere in `schema.md`.
Two enums are defined for tables that simply aren't in the schema. That's a literal sync hole (the kind `instructions.md` says to "stop and ask" about). Either add the draft skeletons or note explicitly that emergency-response tables are deferred and the enums are placeholders.

### D2. 🟡 Draft tables with a bare `tenantId` (no FK to `Tenant`) won't cascade on offboard
**Where:** `WatchlistEntry`, `License`, `TrainingRecord`, `ExceptionRule`, `AnalyticsRollup`, `RetentionPolicy`, `DeletionRequest`, `ConsentRecord`, `DataExport`, `Entitlement`, etc. — `tenantId` scalar, no `tenant Tenant @relation`.
The FINAL tables cascade transitively (Tenant→User/Property→children), so "single delete offboards a hotel" mostly holds *there*. But these scalar-only tables have no FK path, so a tenant delete leaves them orphaned. Tie this to the A8 decision: whichever offboarding model you choose (hard delete vs tombstone), these tables need to be in it explicitly.

### D3. 🟡 `Tenant.status` is stringly-typed while everything else uses enums
**Where:** `Tenant.status String @default("active")` (1); also `PmsConnection.status String`.
Minor inconsistency, but `Tenant.status` gates whether a whole tenant is active/suspended — worth an enum (`ACTIVE`/`SUSPENDED`/`CANCELED`) so feature-gating code isn't comparing magic strings. (And confirm: does `Subscription.status PAST_DUE` or `Tenant.status` drive lockout? Two status fields could disagree — see D4.)

### D4. 🟡 Two overlapping limit/status sources for billing
**Where:** `Subscription.propertiesLimit` + `Subscription.status` (48) vs `Entitlement.limit`/`enabled` (50), and `Tenant.status` (1).
Property/seat limits live in both `Subscription` and `Entitlement`; "is this tenant cut off" could be read from `Subscription.status`, `Entitlement.enabled`, or `Tenant.status`. Decide the single source of truth for each enforcement decision before billing is wired, or gates will contradict each other. (Draft — but worth pinning the model now.)

---

## E. Clarifying questions (compiled)

Grouped; the high-impact ones are starred. Each maps to a hole above.

**Security / auth**
1. ★ Refresh-token reuse detection: add a token-lineage table, or a `previousTokenHash`/`generation` on `Session`? (A1)
2. ★ Public guest form: confirm the link is a signed/opaque token (not the tenant slug), and define *what* sets tenant context for that unauthenticated, fail-closed write. Revocable links — `GuestFormLink` table or not? (B1)
3. ★ Web token storage / CSRF: access token in memory + refresh in httpOnly cookie (→ CSRF on auth routes), or bearer-header everywhere (→ storage answer)? (B3)
4. Is the ~15-min revocation latency (access-token TTL + heartbeat) an accepted MVP risk, including for "revoke a lost login"? (B2)
5. ★ Define the platform-operator/support access model and whether impersonation exists (and how it's audited). Is `SUPER_ADMIN` tenant-top or platform-level? (B6)
6. ★ When is `UserPropertyAccess` enforced vs bypassed, by role? Empty access set = all or none? (B8)
7. Socket.IO: how is token expiry/revocation handled on a long-lived connection? (B9)
8. MFA in or out for MVP? (B7)

**Data model — FINAL tables**
9. ★ Add `scanStatus` to `MediaAsset` and gate signed URLs on it? (A2)
10. ★ Make `MediaAsset.uploadedById` nullable / add `uploaderType` for anonymous uploads? (A3)
11. ★ Add invite/password-reset/set-password token support — where? (A7)
12. ★ Is `zoneId` a real FK or a declared loose pointer? Either way, who validates `zone.propertyId == record.propertyId`? (A9)
13. Add a `correctsId` self-link on `LogbookEntry`/`AuditLog` for corrections? (A12)
14. Will `Incident` need `acknowledgedAt`/`respondedAt` to support incident SLAs later? Decide now since it's FINAL. (C3)

**Outbox / consistency**
15. ★ Which dedup mechanism for idempotent consumers — unique constraints (`LogbookEntry`, `Notification`) or a `ProcessedEffect` ledger? (A4)
16. ★ Add `nextAttemptAt` (+ `lockedUntil`) to `OutboxEvent`; and is retry/DLQ owned by the outbox table or BullMQ (not both)? (A5)
17. ★ Append-only vs duplicate tagging: is `isDuplicate` the one permitted mutation, or should the duplicate tag be derived at read time (drop the stored column)? (A6)

**Privacy / lifecycle**
18. ★ Tenant offboarding: true hard delete (reconcile with append-only + tombstone rule) or tenant-level tombstone/export-then-purge? (A8)
19. Right-to-erasure: real subject entity, or a documented PII-field registry the tombstone job walks? (B4)
20. Add a legal-hold/open-incident exemption to the purge job + a hold flag? (B5)

**Product logic**
21. Define "required posts" baseline for coverage-gap detection — or descope "unassigned post"? (C1)
22. Patrol overdue rule: add an operating window/anchor to `PatrolRoute`, or define the exact rule? (C2)
23. How are dynamic `fieldValues` validated against a version's JSON field-spec (Ajv / Zod-from-JSON)? (C4)
24. Confirm CRITICAL notifications bypass quiet hours / per-channel disables. (C5)
25. Timeline eventual consistency: optimistic insert vs "pending" state in the UI? (C6)
26. Seat counting excludes GUARD roster rows? (C8)

**Schema hygiene**
27. ★ Emergency tables (`EmergencyPlaybook`/`EmergencyEvent`): add draft skeletons or formally defer (and mark the orphan enums)? (D1)
28. `AnalyticsRollup`: sentinel instead of NULL `propertyId` so re-roll stays idempotent? (A10)
29. Specify the fail-closed filter's tenant-exempt model allowlist + a leak-suite test that locks it. (A11)
30. Make `Tenant.status` an enum; pin the single source of truth for tenant lockout across `Tenant.status` / `Subscription.status` / `Entitlement`. (D3/D4)

---

## F. What I'd fix *before* writing Stage-0/1 code (the short list)

If you do nothing else from this doc first, do these — each forces a FINAL-table schema change that's expensive to retrofit:

1. **A2** `MediaAsset.scanStatus` (+ A3 nullable/`uploaderType`).
2. **A1** refresh-token lineage on `Session` (the Stage-0 gate depends on it).
3. **A4 + A5** outbox idempotency key + `nextAttemptAt` (the Stage-1.3 absolute gate depends on it).
4. **A7** invite/reset token table.
5. **A11** tenant-exempt allowlist baked into the kernel + leak-suite assertion (it's the heart of the #1 control).
6. **A6 / A8** resolve the two append-only contradictions (duplicate tagging; tenant-delete) — they're decisions, not code, but they change table design.

Everything else can be slotted in at its module's build time without rework.
