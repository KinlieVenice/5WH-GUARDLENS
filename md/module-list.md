# Module List — Hotel Security Operations Platform

What the product does, module by module. Part of the handoff package:
`schema.md` · `architecture.md` · **`module-list.md`** (this file) · `checklist.md` · `instructions.md`.

**Software-only.** No hardware: no patrol reader devices, NFC tags, panic buttons, access-control hardware, or CCTV analytics. Users are the **control room, supervisors, managers, and owners**. Line guards carry radios and no phones — they **never use the system**; the control room logs for them.

---

## Two realities that shape everything
1. **Line guards never use the system.** They report by radio; control room/supervisors log it. The product is built for desk + roaming-supervisor users.
2. **Multi-tenant SaaS.** Many hotels, one system, each seeing only its own data. Tenant isolation is the #1 control (`architecture.md` §4.3).

## Who uses what
- **Control room / front desk — desktop web.** The hub and primary user. Logs incidents, maintains the shift log, monitors dispatch, runs reports.
- **Supervisors & managers — phone/tablet app.** Roaming oversight: log incidents, respond to alerts, run inspections, log patrols.
- **Owners / GMs — read-only portal (later phase).**
- **Line guards — not users.**

---

## MVP boundary (this is a roadmap, not a build plan)
- **Ship first (MVP):** all of Phase 0 + the Phase 1 operational core (logbook, incident catalog, evidence, staff/shifts, manual patrol logging, audit).
- **Fast-follow (a few of Phase 2):** alerts & dispatch (15), manage-by-exception (14), visitor management (7), equipment/key tracking (8).
- **Later, gated on demand:** the rest of Phase 2, Phase 3 analytics beyond the live dashboard, all of Phase 4 AI, PMS (25), stakeholder portal (24).

Build order is enforced in `checklist.md`.

---

# Phase 0 — Foundation (MVP) · tables 1–11

### 0.1 Multi-tenancy & data isolation
Each hotel is a tenant; one can never see another's data. Enforced automatically on every query, **fails closed** (no tenant context ⇒ rejected, not run wide-open). Defense in depth: global filter + per-record checks + a leak-test suite that tries to breach it. Retrofitting this later is a rewrite, so it's built first. → tables `Tenant`.

### 0.2 RBAC & user management
Role hierarchy per property: supervisor → security manager → hotel admin → super-admin. **Guards exist as roster names only — they never log in.** Invite/deactivate/reassign; scope a user to specific properties. Session management lists each user's logins with a **revoke** for a lost one. → `User`, `UserPropertyAccess`, `Session`.

### 0.3 Tenant onboarding & provisioning
Self-serve setup so a hotel admin configures their own account: build the property map (buildings → floors → zones), invite staff, assign roles. Must exist so you onboard hotel #2 and #3 without manual DB work. → `Property`, `Building`, `Floor`, `Zone`.

### 0.4 Offline capability (supervisor app)
The supervisor mobile app queues work offline and syncs on reconnect with conflict handling. Cached data is encrypted with an app-tied key (not reliant on a phone PIN). *(Note: late sync is why analytics key on business time — `architecture.md` §9.)*

### 0.5 Notifications backbone
One shared engine, fed by the **outbox**: modules emit an event; this layer picks the channel (in-app/push/SMS/email), respects preferences + quiet hours, and retries. → `NotificationPreference`, `Notification`, `OutboxEvent`.

---

# Phase 1 — Operational Core (MVP) · tables 12–23

### 1. Security logbook (unified timeline)
A single chronological timeline of all events. Filter by type, search, date range. **Each entry is clickable** to its full report. **Manual entries** for anything not covered by a module. **Duplicate handling:** a duplicate is **soft-deleted but stays visible, tagged "Duplicate."** The summary is a **point-in-time snapshot** (editing the source later doesn't rewrite the timeline). → `LogbookEntry`.

### 2. Event creation & report catalog
Manual entry by control-room/supervisor staff. **A catalog of report types**, not one hardcoded screen. Ships with prebuilt types (Theft, Trespass, Guest Dispute, Medical, Hazard, Lost Item). Admins add/edit fields without code. **Schema versioning:** each report pins the form version it was filed against. Each type carries a **routing lane** (security vs safety). → `ReportType`, `ReportTypeVersion`.

### 3. Staff & shift management
Build rosters; assign guards to shifts and posts. Clock-in/out + coverage-gap detection (no-show, unassigned post). Provides the "who was on duty when X happened" context. → `Shift`, `ShiftAssignment`, `AttendanceEvent`.

### 4. Patrol logging & scheduling (software-only)
Define patrol **routes/rounds** and an **expected schedule** (e.g. a round every 2 hours). The control room/supervisor **logs each round manually** (which area, when, by whom, exceptions). The system compares logged vs expected so an overdue round is flagged (feeds module 14). No hardware. → `PatrolRoute`, `PatrolLog`.

### 5. Incident reporting + evidence
**Every incident is filed through a catalog report type (module 2)** — there is no "basic" path. Attach notes + photos; set status (Open/Investigating/Closed). Auto-links into the logbook. **Evidence & chain of custody:** media in access-controlled storage, served via short-lived signed links; every touch logged. → `Incident`, `MediaAsset`, `EvidenceAccessLog`.

### 6. Audit log
Append-only, tamper-evident record of who viewed/changed sensitive data. Covers incident edits, deletions, evidence access, report generation, permission changes, session revocations. Never editable through the app. → `AuditLog`.

---

# Phase 2 — Operations Expansion (fast-follow / later) · tables 24–36

### 7. Visitor & contractor management *(fast-follow)*
Register non-guests; record host/room. Entry/exit tracking + history; badge record. Produces an evacuation list. Screens new entries against the watchlist (12). → `Visitor`, `VisitorEntry`, `Badge`.

### 8. Equipment & key management *(fast-follow)*
Issue/return tracking for keys, radios, etc.; assignment history; missing-item flags. A software inventory record — tracks items, doesn't control them. → `Equipment`, `EquipmentAssignment`.

### 9. Lost & found
Register a **Lost** or **Found** item. **Claim workflow:** changing status to **Claimed** loads extra fields — who claimed it, who found it, and a **photo attachment as proof**. Auto-match found-vs-claimed. → `LostFoundItem`. *(Needs `MediaAsset` generalized — see `schema.md` open items.)*

### 10. Access control (soft version)
A **software record** of staff internal access / restricted-area entries (logged, not enforced). → `AccessLog`.

### 11. Emergency response
Playbooks for fire/medical/security tied to floor plans + evacuation routes; emergency timeline + response logging on a command view; one-tap mass notification (software push/SMS). → `EmergencyPlaybook`, `EmergencyEvent` (draft).

### 12. Banned-person watchlist (manual)
A manual "flag this person" list (name + notes) a security manager maintains; surfaced at visitor check-in. ID scanning intentionally left out (heaviest privacy burden). → `WatchlistEntry`.

### 13. Licensing, certification & training tracking
Stores guard license/cert records + expiry; renewal reminders (90/60/30/20 days). Tracks training + refreshers. Maps to RA 5487; can block scheduling a lapsed guard. → `License`, `TrainingRecord`.

### 14. Manage-by-exception alerting *(fast-follow)*
**A display philosophy, not a tracker.** The system stays quiet and only surfaces what's **wrong or overdue**; a background job checks continuously. **Monitors the security team's operational performance — never guests.** Specifically: **unacknowledged alerts**, **SLA breaches** (SLA = time targets you configure here, not a separate module), and **overdue patrols** (a scheduled round whose manual log wasn't entered in time). Configurable thresholds prevent alert fatigue. → `ExceptionRule`.

### 15. Alerts & dispatch *(fast-follow)*
A live command view for urgent events. Fed by **radio calls the operator logs**, guest reports (17), and system-generated exceptions (14). Assign/acknowledge/resolve; times feed SLA + KPIs. Real-time via Socket.IO. → `Alert`.

### 16. *(removed)* Lone-worker / guard duress
Removed in v3 — guards carry radios and no phones; nothing for software to add.

### 17. Public guest safety reporting (optional)
A no-login link for a guest to report a concern. **Anonymous by design** — requiring proof of guest status risks blocking a real emergency. Kept sane without verification via rate limiting, CAPTCHA, photo/spam scanning, and **human triage** (an operator judges legitimacy before it becomes an incident). **Optional** room-number field as a soft spam-deterrent (never required). True verification would need PMS (25). Routes into dispatch (15); privacy notice at collection. → `GuestReport`.

---

# Phase 3 — Analytics & Intelligence (later) · tables 37–43

### 18. Operational dashboard *(near-term)*
Live overview: active incidents · visitors inside · staff on duty · open alerts. Reads current state from the **primary** DB (short cache), never a lagging replica. *(No table of its own.)*

### 19. Security performance analytics
Incident frequency by type · peak hours · high-risk locations · repeat offenders. Reads rollups. → `AnalyticsRollup`.

### 20. Staff performance analytics
**Patrol-log completion rate** · response time · incident-handling speed · attendance reliability. → `AnalyticsRollup`.

### 21. Risk heatmaps
Location-based risk over the property map (lobby = visitor activity, parking = theft, floors = complaints). Served from rollups. → `AnalyticsRollup` (BY_ZONE).

### 22. Compliance & inspection reports
Fire-drill readiness · equipment-inspection · patrol compliance · safety-checklist completion. Supervisors complete mobile checklists; outputs audit-readiness reports. → `InspectionChecklist`, `InspectionRun`.

### 23. Report generator (custom date-range exports)
Any start/end or a preset; scope by property/region/chain; export PDF/Excel, on demand or scheduled. Big jobs run in the background → download link. Guardrails (reject end-before-start, default range). → `ReportSchedule`, `GeneratedReport`.

### 24. Client / stakeholder portal
A read-only view for GM/owner: site activity, incident summaries, KPIs, trends — no operational clutter. A premium upsell on the same analytics backend. *(No table of its own — scoped read.)*

### 25. PMS integration
Connect to the hotel's PMS (e.g. Opera); link an incident to a real room/guest/reservation. Also what would enable true guest verification for module 17. → `PmsConnection`, `PmsReservationLink`.

---

# Phase 4 — AI Layer (later) · tables 44–46

All AI **drafts/suggests; a human commits**; numbers are computed in code, never invented. Runs async, audited. → `AiJob`.

### 26. AI incident report generator
Raw notes → a formal narrative the supervisor edits + approves before saving.

### 27. AI security assistant
Suggests likely category + next actions — a copilot, not an auto-actor.

### 28. AI analytics insights
Plain-language findings over the data ("incidents up 22% in parking"). Code computes the numbers; AI writes the prose.

### 29. Predictive risk engine
Predicts high-risk times/locations; suggests staffing adjustments.

### 30. Natural-language logbook search
Plain-language questions → a validated, tenant-scoped filter (never raw SQL) your normal layer runs.

### 31. AI executive report generator
One-click daily/weekly/monthly summaries drafted from the data.

### 32. Cross-tenant shared intelligence
Opt-in network: a person flagged at one property can warn participating others. Strictly opt-in, consent-aware. → `TenantNetworkOptIn`, `SharedIntelligenceEntry`. *(The one deliberate exception to tenant-scoping — see `schema.md`.)*

---

# Cross-cutting (runs alongside every phase) · tables 47–54

### Data privacy (RA 10173)
Privacy notice at collection; **deletion = anonymize/tombstone**, not hard-delete; configurable retention/auto-purge; the audit log + encryption are your "security measures" evidence. → `RetentionPolicy`, `DeletionRequest`, `ConsentRecord`, `DataExport`.

### Billing & subscriptions
Plan tiers, per-property/seat pricing; PayMongo (PH) / Stripe (global); enforces entitlements. Manual invoicing fine for pilots. → `Plan`, `Subscription`, `Invoice`, `Entitlement`.

### Pilot enablement
A seeded demo tenant ("Sample Hotel") so demos show real dashboards; a printable in-room/lobby template for the guest-safety link. *(Data + collateral, not tables.)*

---

# Module index

| # | Module | Phase | MVP? | Tables |
|---|--------|-------|------|--------|
| 0.1 | Multi-tenancy & data isolation | 0 | ✅ | 1 |
| 0.2 | RBAC & user management | 0 | ✅ | 2,3,4 |
| 0.3 | Tenant onboarding & provisioning | 0 | ✅ | 5,6,7,8 |
| 0.4 | Offline capability (supervisor app) | 0 | ✅ | — (client) |
| 0.5 | Notifications backbone | 0 | ✅ | 9,10,11 |
| 1 | Security logbook | 1 | ✅ | 22 |
| 2 | Event creation & report catalog | 1 | ✅ | 12,13 |
| 3 | Staff & shift management | 1 | ✅ | 17,18,19 |
| 4 | Patrol logging & scheduling | 1 | ✅ | 20,21 |
| 5 | Incident reporting + evidence | 1 | ✅ | 14,15,16 |
| 6 | Audit log | 1 | ✅ | 23 |
| 7 | Visitor & contractor management | 2 | fast-follow | 24,25,26 |
| 8 | Equipment & key management | 2 | fast-follow | 27,28 |
| 9 | Lost & found | 2 | later | 29 |
| 10 | Access control (soft) | 2 | later | 30 |
| 11 | Emergency response | 2 | later | (draft) |
| 12 | Banned-person watchlist | 2 | later | 31 |
| 13 | Licensing/cert/training | 2 | later | 32,33 |
| 14 | Manage-by-exception | 2 | fast-follow | 34 |
| 15 | Alerts & dispatch | 2 | fast-follow | 35 |
| 16 | ~~Lone-worker / duress~~ | — | removed | — |
| 17 | Public guest safety reporting | 2 | optional | 36 |
| 18 | Operational dashboard | 3 | near-term | — (live) |
| 19 | Security performance analytics | 3 | later | 37 |
| 20 | Staff performance analytics | 3 | later | 37 |
| 21 | Risk heatmaps | 3 | later | 37 |
| 22 | Compliance & inspection | 3 | later | 38,39 |
| 23 | Report generator | 3 | later | 40,41 |
| 24 | Stakeholder portal | 3 | later | — (scoped read) |
| 25 | PMS integration | 3 | later | 42,43 |
| 26–31 | AI features | 4 | later | 44 |
| 32 | Cross-tenant shared intelligence | 4 | later | 45,46 |
| — | Data privacy | cross-cutting | ✅ | 51,52,53,54 |
| — | Billing & subscriptions | cross-cutting | pilot: manual | 47,48,49,50 |
| — | Pilot enablement | cross-cutting | ✅ | — |
