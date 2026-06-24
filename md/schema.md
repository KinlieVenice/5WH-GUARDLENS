# Schema — Hotel Security Operations Platform

The complete data model, table by table. Part of the development handoff package:
**`schema.md`** (this file) · `architecture.md` · `module-list.md` · `checklist.md` · `instructions.md`.

Stack: Node/Express + TypeScript + Prisma + MySQL + Redis + Socket.IO. Software-only (no hardware).

**Status legend**
- **Tables 1–23 (Phase 0 & 1) = FINAL.** Build from these as written.
- **Tables 24–54 (Phase 2–4 + cross-cutting) = DRAFT skeletons.** Connections and module ownership are reliable; **exact fields will change** when each module is specified. Do not build Phase 2+ tables verbatim — redesign fields when you spec the module.

---

## The 3 ways tables connect (read first)

1. **Formal relation (real foreign key)** — e.g. `Incident.propertyId → Property.id`. Used when the link is structural and the database should enforce it.
2. **`tenantId` scalar** — every tenant-owned table has it. It's how one hotel's data is isolated from another's. It's an indexed plain column, not a drawn relation; isolation is enforced **in code** by the fail-closed tenant filter (see `architecture.md` §4.3), never by the schema alone.
3. **Loose pointer (`sourceType` + `sourceId`, no FK)** — used by the logbook, audit log, alerts, and AI jobs so one table can reference *any* other without a column per source type. Flexible; integrity is enforced by the application, not the database.

**Actor/log convention:** actors and cross-table references use a plain `...Id` column (e.g. `createdById`, `uploadedById`), **not** a formal `User` relation — keeps high-volume tables loosely coupled and stops `User` collecting dozens of back-links.

**Two open schema items** flagged during design (resolve before building the affected tables):
- **`MediaAsset` is incident-only today.** Lost & found (table 29) needs to attach a proof photo, so `MediaAsset` should be generalized with an `ownerType`/`ownerId` pair so any module can attach evidence.
- **`SharedIntelligenceEntry` (table 46) is the one deliberate exception to tenant-scoping** — keyed by `originTenantId`, visible across opted-in tenants. Treat with extra care; it bypasses the rule the rest of the system depends on.

---

## Dependency / build order (Phase 0 & 1)

```
Tenant
 └─ User ─ UserPropertyAccess ─ Session
 └─ Property ─ Building ─ Floor ─ Zone
 └─ NotificationPreference / Notification / OutboxEvent
      ▼
 ReportType ─ ReportTypeVersion ─ Incident ─ MediaAsset ─ EvidenceAccessLog
 Shift ─ ShiftAssignment ─ AttendanceEvent
 PatrolRoute ─ PatrolLog
 LogbookEntry      (the timeline everything feeds)
 AuditLog          (immutable record of sensitive actions)
```

---

## Enums

```prisma
// Phase 0 & 1 (final)
enum Role            { GUARD SUPERVISOR SECURITY_MANAGER HOTEL_ADMIN SUPER_ADMIN }
enum UserStatus      { INVITED ACTIVE SUSPENDED }
enum ReportLane      { SECURITY SAFETY }
enum IncidentStatus  { OPEN INVESTIGATING CLOSED }
enum IncidentSeverity{ LOW MEDIUM HIGH CRITICAL }
enum ClockType       { CLOCK_IN CLOCK_OUT }
enum NotificationChannel { IN_APP PUSH SMS EMAIL }
enum NotificationStatus  { PENDING SENT FAILED READ }
enum EvidenceAction  { UPLOAD VIEW DOWNLOAD DELETE }
enum LogbookEntryType{ INCIDENT VISITOR PATROL EQUIPMENT NOTE SHIFT }
enum OutboxStatus    { PENDING PROCESSED FAILED }
enum PatrolLogStatus { COMPLETED MISSED EXCEPTION }

// Phase 2–4 + cross-cutting (draft)
enum VisitorType    { VISITOR CONTRACTOR VENDOR CANDIDATE }
enum VisitorStatus  { EXPECTED ON_SITE CHECKED_OUT }
enum EquipmentType  { KEY RADIO OTHER }
enum EquipmentStatus{ AVAILABLE ISSUED MISSING RETIRED }
enum LostFoundKind  { LOST FOUND }
enum LostFoundStatus{ OPEN CLAIMED RETURNED DISPOSED }
enum EmergencyKind  { FIRE MEDICAL SECURITY OTHER }
enum EmergencyStatus{ ACTIVE CONTAINED CLOSED }
enum AlertSource    { RADIO GUEST_REPORT SYSTEM }
enum AlertStatus    { OPEN ACKNOWLEDGED RESOLVED }
enum GuestReportStatus { NEW TRIAGED CLOSED }
enum RollupDimension   { BY_TYPE BY_HOUR BY_ZONE BY_PROPERTY }
enum ReportJobStatus   { QUEUED RUNNING READY FAILED }
enum AiJobKind     { NARRATIVE CLASSIFY INSIGHTS EXEC_REPORT NL_SEARCH }
enum AiJobStatus   { QUEUED RUNNING DONE FAILED }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED }
enum InvoiceStatus { DRAFT OPEN PAID VOID }
enum DeletionStatus{ REQUESTED PROCESSING COMPLETED }
```

---

# PHASE 0 — Foundation (FINAL) · Modules 0.1–0.5

## 1. Tenant
```prisma
model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  status    String   @default("active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users          User[]
  properties     Property[]
  sessions       Session[]
  reportTypes    ReportType[]
  incidents      Incident[]
  logbookEntries LogbookEntry[]
  shifts         Shift[]
  patrolRoutes   PatrolRoute[]
  notifications  Notification[]
  outboxEvents   OutboxEvent[]
  auditLogs      AuditLog[]
}
```
**Module 0.1.** Root of the system — one row per hotel/chain. Points to nothing; almost everything points back via `tenantId`. Everything cascades from here, so offboarding a hotel is a single delete. This is the table the whole isolation rule is built around.

## 2. User
```prisma
model User {
  id           String     @id @default(cuid())
  tenantId     String
  email        String
  name         String
  passwordHash String?     // NULL for guards — they never log in
  role         Role        @default(GUARD)
  status       UserStatus  @default(INVITED)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  tenant            Tenant                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  propertyAccess    UserPropertyAccess[]
  sessions          Session[]
  shiftAssignments  ShiftAssignment[]
  attendanceEvents  AttendanceEvent[]
  createdIncidents  Incident[]               @relation("IncidentCreatedBy")
  assignedIncidents Incident[]               @relation("IncidentAssignedTo")
  notifPreferences  NotificationPreference[]

  @@unique([tenantId, email])
  @@index([tenantId, role])
}
```
**Module 0.2.** Points to `Tenant`. Pointed to by sessions, shift assignments, attendance, incidents (creator/assignee), property access, notification prefs. `passwordHash` is **nullable** because guards are roster names that never log in — session issuance is hard-gated against the `GUARD` role in code. `@@unique([tenantId, email])` = email unique *within* a hotel.

## 3. UserPropertyAccess
```prisma
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
```
**Module 0.2 (property-scope half).** Join table linking `User`↔`Property`. The second of the "two locks": tenant check + property check. A supervisor who covers 2 of a chain's 5 hotels is narrowed here.

## 4. Session
```prisma
model Session {
  id               String    @id @default(cuid())
  tenantId         String
  userId           String
  refreshTokenHash String    @unique
  deviceLabel      String?
  userAgent        String?
  ipAddress        String?
  createdAt        DateTime  @default(now())
  lastSeenAt       DateTime  @default(now())
  expiresAt        DateTime
  revokedAt        DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId])
}
```
**Module 0.2 + auth.** One row per login/device. Refresh token stored **hashed**. Revoke a lost login by setting `revokedAt`; the app logs out on next heartbeat. Short-lived access tokens bound the exposure window.

## 5. Property
```prisma
model Property {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  address   String?
  timezone  String   @default("Asia/Manila")
  createdAt DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  buildings      Building[]
  zones          Zone[]
  incidents      Incident[]
  logbookEntries LogbookEntry[]
  shifts         Shift[]
  patrolRoutes   PatrolRoute[]
  userAccess     UserPropertyAccess[]
}
```
**Module 0.3.** Top of the physical hierarchy. `timezone` lives here (a chain can span zones; "what day did this happen" is property-local). Most operational data is "at a property," so many tables point here.

## 6. Building
```prisma
model Building {
  id         String @id @default(cuid())
  tenantId   String
  propertyId String
  name       String

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  floors   Floor[]

  @@index([tenantId, propertyId])
}
```
**Module 0.3.** Points to `Property`; pointed to by `Floor`. Carries its own `tenantId` (denormalized) so isolation is one column check, not a join chain.

## 7. Floor
```prisma
model Floor {
  id         String @id @default(cuid())
  tenantId   String
  buildingId String
  name       String
  level      Int    @default(0)

  building Building @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  zones    Zone[]

  @@index([tenantId, buildingId])
}
```
**Module 0.3.** Points to `Building`; pointed to by `Zone`. `level` is numeric so floors sort (B2=-2 … Ground=0).

## 8. Zone
```prisma
model Zone {
  id         String  @id @default(cuid())
  tenantId   String
  propertyId String
  floorId    String?
  name       String

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  floor    Floor?   @relation(fields: [floorId], references: [id], onDelete: SetNull)

  @@index([tenantId, propertyId])
}
```
**Module 0.3.** A named area ("Lobby", "Parking"). Always belongs to a `Property`; `floorId` **optional** so property-wide zones and floor-level zones both work. Referenced loosely by incidents, shift posts, patrol logs.

## 9. NotificationPreference
```prisma
model NotificationPreference {
  id       String              @id @default(cuid())
  tenantId String
  userId   String
  channel  NotificationChannel
  enabled  Boolean             @default(true)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, channel])
  @@index([tenantId, userId])
}
```
**Module 0.5.** One row per user per channel ("SMS yes, email no"). Read by the delivery worker before sending.

## 10. Notification
```prisma
model Notification {
  id        String              @id @default(cuid())
  tenantId  String
  userId    String              // recipient (plain id)
  type      String
  channel   NotificationChannel
  status    NotificationStatus  @default(PENDING)
  payload   Json
  createdAt DateTime            @default(now())
  sentAt    DateTime?
  readAt    DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId, status])
}
```
**Module 0.5.** Created `PENDING`; the worker flips to `SENT`/`FAILED`; `readAt` set when opened. `payload` JSON lets any module send any message without a schema change.

## 11. OutboxEvent
```prisma
model OutboxEvent {
  id          String       @id @default(cuid())
  tenantId    String
  type        String       // e.g. "incident.created"
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  createdAt   DateTime     @default(now())
  processedAt DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([status, createdAt])
  @@index([tenantId, type])
}
```
**Reliability backbone (see `architecture.md` §6).** Written **in the same transaction** as the state change that produced it, so "it happened" and "deliver it" are all-or-nothing. A relay worker reads `PENDING` rows and fans out (notifications, logbook lines), retrying via `attempts`. This is what stops a crash from losing or duplicating downstream effects.

---

# PHASE 1 — Operational Core (FINAL) · Modules 1–6

## 12. ReportType
```prisma
model ReportType {
  id        String     @id @default(cuid())
  tenantId  String
  key       String
  name      String
  lane      ReportLane @default(SECURITY)
  isSystem  Boolean    @default(false)
  isActive  Boolean    @default(true)
  createdAt DateTime   @default(now())

  tenant    Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  versions  ReportTypeVersion[]
  incidents Incident[]

  @@unique([tenantId, key])
  @@index([tenantId, lane])
}
```
**Module 2.** One catalog entry ("Theft", "Hazard"). `lane` drives routing (security vs safety). `isSystem` = shipped prebuilt. Fields live in versions, not here.

## 13. ReportTypeVersion
```prisma
model ReportTypeVersion {
  id           String   @id @default(cuid())
  tenantId     String
  reportTypeId String
  version      Int
  schema       Json     // [{ key, label, type, required, options? }]
  createdById  String
  createdAt    DateTime @default(now())

  reportType ReportType @relation(fields: [reportTypeId], references: [id], onDelete: Cascade)
  incidents  Incident[]

  @@unique([reportTypeId, version])
  @@index([tenantId, reportTypeId])
}
```
**Module 2 (versioning).** Editing a form creates a **new version row** rather than mutating the old one, so old reports (pinned to v1) never break when a field is added (v2). Fields are JSON so admins change forms without migrations.

## 14. Incident
```prisma
model Incident {
  id                  String           @id @default(cuid())
  tenantId            String
  propertyId          String
  zoneId              String?
  reportTypeId        String
  reportTypeVersionId String
  status              IncidentStatus   @default(OPEN)
  severity            IncidentSeverity @default(MEDIUM)
  title               String
  fieldValues         Json
  occurredAt          DateTime
  reportedAt          DateTime         @default(now())
  createdById         String
  assignedToId        String?
  duplicateOfId       String?          // self-link if this is a duplicate
  deletedAt           DateTime?        // soft-delete (duplicate handling)
  closedAt            DateTime?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  tenant            Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property          Property          @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  reportType        ReportType        @relation(fields: [reportTypeId], references: [id])
  reportTypeVersion ReportTypeVersion @relation(fields: [reportTypeVersionId], references: [id])
  createdBy         User              @relation("IncidentCreatedBy", fields: [createdById], references: [id])
  assignedTo        User?             @relation("IncidentAssignedTo", fields: [assignedToId], references: [id])
  duplicateOf       Incident?         @relation("IncidentDuplicate", fields: [duplicateOfId], references: [id])
  duplicates        Incident[]        @relation("IncidentDuplicate")
  media             MediaAsset[]

  @@index([tenantId, propertyId, status])
  @@index([tenantId, occurredAt])
}
```
**Module 5.** The central operational record — **every incident is filed through a catalog type** (no "basic" path). Pins `reportTypeVersionId` so `fieldValues` stay meaningful. **Duplicate handling (v3):** `deletedAt` soft-deletes; `duplicateOfId` self-links to the real one; the logbook entry stays, tagged. `occurredAt` (business time) drives analytics, separate from `reportedAt`.

## 15. MediaAsset
```prisma
model MediaAsset {
  id           String   @id @default(cuid())
  tenantId     String
  incidentId   String?
  storageKey   String   // object-storage key; the file is NOT in the DB
  fileName     String
  mimeType     String
  sizeBytes    BigInt
  uploadedById String
  createdAt    DateTime @default(now())

  incident   Incident?           @relation(fields: [incidentId], references: [id], onDelete: SetNull)
  accessLogs EvidenceAccessLog[]

  @@index([tenantId, incidentId])
}
```
**Module 5 (evidence).** DB stores only the `storageKey`; the file lives in object storage, served via short-lived signed links only. `sizeBytes` is `BigInt` (video > 2 GB). **Open item:** generalize beyond `incidentId` (add `ownerType`/`ownerId`) so lost & found can attach proof photos.

## 16. EvidenceAccessLog
```prisma
model EvidenceAccessLog {
  id           String         @id @default(cuid())
  tenantId     String
  mediaAssetId String
  userId       String
  action       EvidenceAction
  ipAddress    String?
  at           DateTime       @default(now())

  mediaAsset MediaAsset @relation(fields: [mediaAssetId], references: [id], onDelete: Cascade)

  @@index([tenantId, mediaAssetId, at])
}
```
**Module 5 (chain of custody).** One row per touch (upload/view/download). Write-once. This is what makes evidence defensible for insurance/police.

## 17. Shift
```prisma
model Shift {
  id         String   @id @default(cuid())
  tenantId   String
  propertyId String
  name       String
  startsAt   DateTime
  endsAt     DateTime
  createdAt  DateTime @default(now())

  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property    Property          @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  assignments ShiftAssignment[]

  @@index([tenantId, propertyId, startsAt])
}
```
**Module 3.** A time window at a property. Pointed to by `ShiftAssignment`.

## 18. ShiftAssignment
```prisma
model ShiftAssignment {
  id        String   @id @default(cuid())
  tenantId  String
  shiftId   String
  userId    String   // the guard
  zoneId    String?  // optional post
  createdAt DateTime @default(now())

  shift            Shift             @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  attendanceEvents AttendanceEvent[]

  @@index([tenantId, userId])
  @@index([tenantId, shiftId])
}
```
**Module 3.** Join table putting a guard on a shift (optionally at a `zoneId` post). Answers "who was on duty when X happened."

## 19. AttendanceEvent
```prisma
model AttendanceEvent {
  id                String    @id @default(cuid())
  tenantId          String
  userId            String
  shiftAssignmentId String?
  type              ClockType
  at                DateTime  @default(now())

  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  shiftAssignment ShiftAssignment? @relation(fields: [shiftAssignmentId], references: [id], onDelete: SetNull)

  @@index([tenantId, userId, at])
}
```
**Module 3.** One row per clock-in/out. Compared against assignments to detect no-shows / coverage gaps.

## 20. PatrolRoute
```prisma
model PatrolRoute {
  id                      String   @id @default(cuid())
  tenantId                String
  propertyId              String
  name                    String
  expectedIntervalMinutes Int?     // e.g. 120 = expected every 2h
  createdAt               DateTime @default(now())

  tenant   Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property Property    @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  logs     PatrolLog[]

  @@index([tenantId, propertyId])
}
```
**Module 4 (software-only).** Defines a round and how often it's expected. `expectedIntervalMinutes` is what lets manage-by-exception flag an overdue round. No hardware.

## 21. PatrolLog
```prisma
model PatrolLog {
  id            String          @id @default(cuid())
  tenantId      String
  propertyId    String
  routeId       String?
  performedById String?         // guard who did it (plain id)
  loggedById    String          // operator/supervisor who entered it (plain id)
  status        PatrolLogStatus @default(COMPLETED)
  notes         String?
  performedAt   DateTime
  createdAt     DateTime        @default(now())

  route PatrolRoute? @relation(fields: [routeId], references: [id], onDelete: SetNull)

  @@index([tenantId, propertyId, performedAt])
  @@index([tenantId, routeId, performedAt])
}
```
**Module 4.** Manual record that a round happened. Two ids: `performedById` (the guard) and `loggedById` (who typed it in — guards don't use the app). `status` = COMPLETED/MISSED/EXCEPTION. `performedAt` vs the route interval = overdue detection. Feeds the logbook via loose pointer.

## 22. LogbookEntry
```prisma
model LogbookEntry {
  id          String           @id @default(cuid())
  tenantId    String
  propertyId  String
  type        LogbookEntryType
  occurredAt  DateTime
  summary     String
  sourceType  String?          // loose pointer: "Incident", "PatrolLog", …
  sourceId    String?
  isDuplicate Boolean          @default(false)
  createdById String
  createdAt   DateTime         @default(now())

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId, occurredAt])
  @@index([tenantId, type, occurredAt])
  @@index([tenantId, sourceType, sourceId])
}
```
**Module 1.** The unified timeline. Links to its source via the **loose pointer** (`sourceType`/`sourceId`, no FK) so any module can feed it. **v3 features:** manual `NOTE` entries; click-through via the pointer; `isDuplicate` shows the "Duplicate" tag when an incident is soft-deleted; `summary` is a **point-in-time snapshot** (editing the source later doesn't rewrite the timeline).

## 23. AuditLog
```prisma
model AuditLog {
  id          String   @id @default(cuid())
  tenantId    String
  actorUserId String?  // who (plain id; null for system actions)
  action      String   // "incident.update", "session.revoke"
  entityType  String   // loose pointer …
  entityId    String   // … to any table
  metadata    Json?
  ipAddress   String?
  at          DateTime @default(now())

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, entityType, entityId])
  @@index([tenantId, at])
}
```
**Module 6.** **Append-only** — never updated/deleted by the app. Records sensitive actions across every table (loose pointer). Investigation tool + RA 10173 "security measures" evidence.

---

## Worked example — one incident touches everything
1. Operator authenticated; `Session` valid; `User.role` + `UserPropertyAccess` permit logging at this `Property`.
2. Picks "Theft" → a `ReportType`; app loads its current `ReportTypeVersion` to render the form.
3. Submit. In **one transaction**: an `Incident` row + an `OutboxEvent` ("incident.created").
4. Photos → `MediaAsset` rows; each upload → an `EvidenceAccessLog` row.
5. Outbox relay → writes a `LogbookEntry` (timeline) and queues `Notification` rows.
6. The action is recorded in `AuditLog`.

---

# PHASE 2 — Operations (DRAFT) · Modules 7–17

> Fields below are a starting point; redesign when you spec each module.

## 24. Visitor
```prisma
model Visitor {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  type VisitorType @default(VISITOR)
  name String
  company String?
  hostUserId String?
  status VisitorStatus @default(EXPECTED)
  createdAt DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  entries VisitorEntry[]
  badges Badge[]

  @@index([tenantId, propertyId, status])
}
```
**Module 7.** One non-guest on site. `status` = lifecycle. Screened against the watchlist (31) at registration. `hostUserId` = staff they're visiting.

## 25. VisitorEntry
```prisma
model VisitorEntry {
  id String @id @default(cuid())
  tenantId String
  visitorId String
  zoneId String?
  entryAt DateTime @default(now())
  exitAt DateTime?

  visitor Visitor @relation(fields: [visitorId], references: [id], onDelete: Cascade)

  @@index([tenantId, visitorId])
}
```
**Module 7.** One in/out pair. Open row (`exitAt` null) = currently inside → feeds live dashboard + evacuation list.

## 26. Badge
```prisma
model Badge {
  id String @id @default(cuid())
  tenantId String
  visitorId String?
  code String
  issuedAt DateTime @default(now())
  returnedAt DateTime?

  visitor Visitor? @relation(fields: [visitorId], references: [id], onDelete: SetNull)

  @@index([tenantId, visitorId])
}
```
**Module 7.** Tracked record of a physical badge (not hardware control). `returnedAt` null = still out.

## 27. Equipment
```prisma
model Equipment {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  type EquipmentType @default(OTHER)
  label String
  status EquipmentStatus @default(AVAILABLE)

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  assignments EquipmentAssignment[]

  @@index([tenantId, propertyId, status])
}
```
**Module 8.** Software inventory record of a physical item (key, radio). Tracks, doesn't control.

## 28. EquipmentAssignment
```prisma
model EquipmentAssignment {
  id String @id @default(cuid())
  tenantId String
  equipmentId String
  holderUserId String
  issuedAt DateTime @default(now())
  returnedAt DateTime?

  equipment Equipment @relation(fields: [equipmentId], references: [id], onDelete: Cascade)

  @@index([tenantId, equipmentId])
}
```
**Module 8.** Issue/return history. `returnedAt` null = currently out. The row history is the custody chain for a master key.

## 29. LostFoundItem
```prisma
model LostFoundItem {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  kind LostFoundKind                  // LOST or FOUND (at creation)
  status LostFoundStatus @default(OPEN)
  description String
  location String?
  occurredAt DateTime @default(now())
  // --- fill in only when status = CLAIMED ---
  claimantName String?
  finderName String?
  proofMediaId String?                // proof photo (ref to MediaAsset)
  claimedById String?
  claimedAt DateTime?
  matchedItemId String?               // self-link LOST<->FOUND
  createdAt DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId, status])
}
```
**Module 9.** **v3 claim workflow:** created as LOST/FOUND; changing status to **CLAIMED** is what unlocks the bottom block (claimant, finder, **proof photo**, processor). Nullable because they don't exist until claim. Needs the `MediaAsset` generalization (open item).

## 30. AccessLog
```prisma
model AccessLog {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  userId String
  zoneId String?
  granted Boolean @default(true)
  at DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId, at])
}
```
**Module 10.** Software-only record of restricted-area entries (logged, not enforced). `granted` notes attempts that should've been denied.

## 31. WatchlistEntry
```prisma
model WatchlistEntry {
  id String @id @default(cuid())
  tenantId String
  name String
  notes String?
  addedById String
  isActive Boolean @default(true)
  createdAt DateTime @default(now())

  @@index([tenantId, isActive])
}
```
**Module 12.** Manual "flag this person" list (name + notes; no ID scanning). Read by the visitor module at registration. `isActive` retires without deleting.

## 32. License
```prisma
model License {
  id String @id @default(cuid())
  tenantId String
  userId String
  kind String           // e.g. "SOSIA"
  number String?
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([tenantId, userId, expiresAt])
}
```
**Module 13.** Guard license + expiry. The `expiresAt` index powers reminder jobs (RA 5487). An expired license can block scheduling.

## 33. TrainingRecord
```prisma
model TrainingRecord {
  id String @id @default(cuid())
  tenantId String
  userId String
  course String
  completedAt DateTime?
  refresherDueAt DateTime?

  @@index([tenantId, userId])
}
```
**Module 13.** Training completion + refresher due-date. Same reminder mechanism as licenses.

## 34. ExceptionRule
```prisma
model ExceptionRule {
  id String @id @default(cuid())
  tenantId String
  propertyId String?              // null = tenant-wide
  metric String                   // "overdue_patrol", "alert_unacknowledged", "incident_sla"
  threshold Json                  // { "minutes": 10, "severity": "HIGH" }
  enabled Boolean @default(true)

  @@index([tenantId, metric])
}
```
**Module 14.** This **is** the "SLA" — config rows, not a separate module. Each rule = "watch this metric, surface when it crosses this threshold." The background checker reads these, scans the data, raises exceptions/alerts.

## 35. Alert
```prisma
model Alert {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  source AlertSource              // RADIO / GUEST_REPORT / SYSTEM (no hardware)
  severity IncidentSeverity @default(HIGH)
  status AlertStatus @default(OPEN)
  sourceType String?              // loose pointer to origin
  sourceId String?
  assignedToId String?
  raisedAt DateTime @default(now())
  acknowledgedAt DateTime?
  resolvedAt DateTime?

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId, status])
  @@index([tenantId, raisedAt])
}
```
**Module 15.** One urgent thing needing response. Sources are software-only. The three timestamps feed SLA checks + response-time KPIs. The live dispatch view subscribes via Socket.IO.

## 36. GuestReport
```prisma
model GuestReport {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  category String
  description String
  roomNumber String?              // OPTIONAL soft signal — never required/blocking
  photoMediaId String?
  alertId String?                 // set when promoted to dispatch
  status GuestReportStatus @default(NEW)
  createdAt DateTime @default(now())

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([tenantId, propertyId, status])
}
```
**Module 17.** **No login, no verification by design** (never block a real emergency). `roomNumber` optional soft spam-deterrent. `status` = human-triage flow; promoted to an `Alert` only after an operator judges it legit.

---

# PHASE 3 — Intelligence (DRAFT) · Modules 18–25

> Module 18 (dashboard) and 24 (portal) have **no tables** — dashboard reads live state; portal is a scoped read over the analytics backend.

## 37. AnalyticsRollup
```prisma
model AnalyticsRollup {
  id String @id @default(cuid())
  tenantId String
  propertyId String?
  dimension RollupDimension
  bucketStart DateTime            // BUSINESS time
  bucketEnd DateTime
  metric String
  value Int @default(0)
  data Json?

  @@unique([tenantId, propertyId, dimension, metric, bucketStart])
  @@index([tenantId, dimension, bucketStart])
}
```
**Modules 19–21.** Pre-aggregated summaries so dashboards never scan raw events. `bucketStart` is **business time** so late-syncing data lands right; the `@@unique` lets a run re-roll a bucket idempotently. Heatmaps read `BY_ZONE`.

## 38. InspectionChecklist
```prisma
model InspectionChecklist {
  id String @id @default(cuid())
  tenantId String
  propertyId String
  name String
  items Json

  property Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  runs InspectionRun[]

  @@index([tenantId, propertyId])
}
```
**Module 22.** The checklist *template* (questions in JSON). Same template+instance pattern as `ReportType`.

## 39. InspectionRun
```prisma
model InspectionRun {
  id String @id @default(cuid())
  tenantId String
  checklistId String
  performedById String
  performedAt DateTime @default(now())
  results Json
  score Float?

  checklist InspectionChecklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)

  @@index([tenantId, checklistId, performedAt])
}
```
**Module 22.** One completed run (template + filled `results`).

## 40. ReportSchedule
```prisma
model ReportSchedule {
  id String @id @default(cuid())
  tenantId String
  name String
  params Json
  cron String
  enabled Boolean @default(true)
  createdAt DateTime @default(now())

  reports GeneratedReport[]

  @@index([tenantId, enabled])
}
```
**Module 23 (scheduled side).** Defines a recurring report. On-demand reports skip this and create a `GeneratedReport` directly.

## 41. GeneratedReport
```prisma
model GeneratedReport {
  id String @id @default(cuid())
  tenantId String
  scheduleId String?
  rangeStart DateTime
  rangeEnd DateTime
  status ReportJobStatus @default(QUEUED)
  storageKey String?              // signed-URL access only
  createdAt DateTime @default(now())

  schedule ReportSchedule? @relation(fields: [scheduleId], references: [id], onDelete: SetNull)

  @@index([tenantId, status, createdAt])
}
```
**Module 23 (output).** One report job; big ones run async (QUEUED→RUNNING→READY) and drop a file behind a signed link, same privacy/retention as evidence.

## 42. PmsConnection
```prisma
model PmsConnection {
  id String @id @default(cuid())
  tenantId String
  provider String                 // "opera"
  config Json
  status String @default("active")
  createdAt DateTime @default(now())

  @@unique([tenantId, provider])
}
```
**Module 25.** How to talk to one hotel's PMS. One per provider per tenant. Secrets in `config` should be encrypted / in a secrets manager (open item).

## 43. PmsReservationLink
```prisma
model PmsReservationLink {
  id String @id @default(cuid())
  tenantId String
  incidentId String
  room String?
  reservationId String?
  guestRef String?

  @@index([tenantId, incidentId])
}
```
**Module 25.** Links an incident to a real room/reservation. Kept separate so `Incident` stays PMS-agnostic. Also the path to real guest verification for module 17.

---

# PHASE 4 — AI (DRAFT) · Modules 26–32

## 44. AiJob
```prisma
model AiJob {
  id String @id @default(cuid())
  tenantId String
  kind AiJobKind
  status AiJobStatus @default(QUEUED)
  inputRef String?
  resultRef String?
  createdById String
  createdAt DateTime @default(now())

  @@index([tenantId, kind, status])
}
```
**Modules 26–31.** Every AI action is an async, audited job. `kind` selects the feature. AI only **drafts** (`resultRef`); a human commits — never a direct write to an official record.

## 45. TenantNetworkOptIn
```prisma
model TenantNetworkOptIn {
  id String @id @default(cuid())
  tenantId String
  enabled Boolean @default(false)
  scope Json
  updatedAt DateTime @updatedAt

  @@unique([tenantId])
}
```
**Module 32.** The consent gate. Nothing crosses tenant boundaries unless `enabled`; `scope` limits what.

## 46. SharedIntelligenceEntry
```prisma
model SharedIntelligenceEntry {
  id String @id @default(cuid())
  originTenantId String            // NOT tenantId — visible across opted-in tenants
  subjectName String
  notes String?
  sharedAt DateTime @default(now())

  @@index([originTenantId, sharedAt])
}
```
**Module 32.** **The one deliberate exception to tenant-scoping** — keyed by `originTenantId`, readable across opted-in tenants. Highest-sensitivity data; only created/visible where `TenantNetworkOptIn.enabled`. Extra scrutiny required.

---

# CROSS-CUTTING (DRAFT)

## 47. Plan
```prisma
model Plan {
  id String @id @default(cuid())
  name String
  tier String
  priceJson Json

  subscriptions Subscription[]
}
```
**Billing.** Global (no `tenantId`) — every hotel chooses from the same menu.

## 48. Subscription
```prisma
model Subscription {
  id String @id @default(cuid())
  tenantId String
  planId String
  status SubscriptionStatus @default(TRIALING)
  seats Int @default(0)
  propertiesLimit Int?
  currentPeriodEnd DateTime?

  plan Plan @relation(fields: [planId], references: [id])
  invoices Invoice[]

  @@index([tenantId, status])
}
```
**Billing.** One tenant's current plan + limits. `status` can gate features (`PAST_DUE`). Bridge between global `Plan` and a hotel.

## 49. Invoice
```prisma
model Invoice {
  id String @id @default(cuid())
  tenantId String
  subscriptionId String?
  amount Int                      // minor units (centavos)
  currency String @default("PHP")
  status InvoiceStatus @default(DRAFT)
  issuedAt DateTime @default(now())

  subscription Subscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)

  @@index([tenantId, status])
}
```
**Billing.** A bill. `amount` in minor units (integer) to avoid float money bugs. Manual for pilots.

## 50. Entitlement
```prisma
model Entitlement {
  id String @id @default(cuid())
  tenantId String
  feature String                  // "ai", "portal", "pms"
  enabled Boolean @default(false)
  limit Json?

  @@unique([tenantId, feature])
}
```
**Billing (enforcement).** Runtime "is this hotel allowed feature X?" Decoupled from `Plan` so you can grant one-offs. Checked by feature gates app-wide.

## 51. RetentionPolicy
```prisma
model RetentionPolicy {
  id String @id @default(cuid())
  tenantId String
  entity String                   // "evidence" / "incident" / "audit"
  horizonDays Int

  @@unique([tenantId, entity])
}
```
**Privacy.** Per-tenant "keep this kind of data N days." Read by the daily purge job (which deletes the files too, not just rows).

## 52. DeletionRequest
```prisma
model DeletionRequest {
  id String @id @default(cuid())
  tenantId String
  subjectRef String
  status DeletionStatus @default(REQUESTED)
  requestedAt DateTime @default(now())
  completedAt DateTime?

  @@index([tenantId, status])
}
```
**Privacy.** Right-to-erasure tracking. Resolution is **anonymize/tombstone**, not hard-delete — keep audit references, scrub PII.

## 53. ConsentRecord
```prisma
model ConsentRecord {
  id String @id @default(cuid())
  tenantId String
  subjectRef String
  purpose String
  capturedAt DateTime @default(now())

  @@index([tenantId, subjectRef])
}
```
**Privacy.** Proof consent/notice was given at collection (e.g. the guest-form notice). The evidence side of RA 10173.

## 54. DataExport
```prisma
model DataExport {
  id String @id @default(cuid())
  tenantId String
  status ReportJobStatus @default(QUEUED)
  storageKey String?
  requestedAt DateTime @default(now())

  @@index([tenantId, status])
}
```
**Privacy.** A tenant requesting a copy of their own data. Async job → file behind a signed link. Also useful for a future DB-per-tenant migration.

---

## Three patterns to remember
1. **Template + instance:** `ReportType→Incident`, `ReportTypeVersion→Incident`, `InspectionChecklist→InspectionRun`, `PatrolRoute→PatrolLog`.
2. **Join table:** `UserPropertyAccess`, `ShiftAssignment`, `EquipmentAssignment`, `VisitorEntry`.
3. **Loose pointer:** logbook, audit log, alerts, AI jobs — `type` + `id`, no FK, app-enforced.

Everything else is a plain parent → child foreign key.

---

## What's final vs draft
- **Tables 1–23 (Phase 0 & 1):** FINAL — build from these.
- **Tables 24–54 (Phase 2–4 + cross-cutting):** DRAFT — use for flow understanding; redesign fields per module when you reach it. Connections and module mapping will hold.
