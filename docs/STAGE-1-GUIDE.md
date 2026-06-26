# Stage 1 Guide — The Operational Core (1.1: Property Hierarchy)

> Companion to [`STAGE-0-GUIDE.md`](STAGE-0-GUIDE.md). Stage 0 built the safe foundation
> (tenant isolation, auth, RBAC). Stage 1 builds the actual product on top of it. This guide
> covers the **first slice, 1.1 — the physical hierarchy** every later feature hangs off.
> Written so a junior dev can follow it. Every new function also has comments in the source.

---

## 1. What Stage 1.1 is

A hotel company (a **tenant**) has physical places: hotels, the buildings in them, the floors
in those buildings, and the named areas ("Lobby", "Parking") on those floors. Stage 1.1 models
that as a four-level tree:

```
Property  (a hotel / site)
  └── Building
        └── Floor          (level: -1 = basement, 0 = ground, …)
              └── Zone      (a named area; can also be property-wide, with no floor)
```

Why first? Because almost everything later in the product is *located somewhere*. Incidents
happen in a zone; shifts are assigned to a property; patrols cover floors. None of that can be
built until the places exist. So 1.1 is the backbone, and it's backend-only — no UI yet (that's
Stage 2).

It adds: the three new tables (Property already existed from Stage 0), admin-only CRUD endpoints,
a cached "property tree" read, a cross-entity safety rule (A9), and an **archive-only** lifecycle
(nothing is ever hard-deleted).

---

## 2. The data model

Three new Prisma models join `Property`; all four gain `archivedAt`. See
[`prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

- **Property** — a hotel/site. Now has `archivedAt`, `buildings`, `zones`.
- **Building** — belongs to a Property.
- **Floor** — belongs to a Building. `level` is a number so floors sort correctly regardless of
  their name (basement `-1` sorts below ground `0`).
- **Zone** — belongs to a Property, and *optionally* to a Floor (`floorId` is nullable). A zone
  with a floor is "floor-level"; a zone with no floor is "property-wide".

Two things every table shares (the Stage 0 pattern): a denormalized **`tenantId`** (so isolation
is one column check, never a join), and **`archivedAt`** (null = active; a date = archived).

**Key idea — we never delete.** "Remove" sets `archivedAt`. Archived rows drop out of every read,
tree, and uniqueness check, but the row stays in the DB. This protects future data (an incident
that pointed at a zone won't suddenly reference a vanished row) and makes "delete" reversible.

---

## 3. A request's life (two examples)

Both run *after* the Stage 0 middleware chain (`resolveTenant → loadContext → authenticate`), so
by the time a handler runs we're already inside the tenant's request context and `getScopedPrisma()`
is locked to that tenant.

**Reading the tree — `GET /api/properties/:id/tree`**
1. Route requires `authenticate` only (any logged-in user can read).
   ([`properties.routes.ts:13`](../apps/api/src/modules/properties/properties.routes.ts))
2. `getTree` controller asks `accessiblePropertyIds()` what this user may see. If the property
   isn't in their set, it throws **404** (not 403 — we don't reveal that the property exists).
   ([`properties.controller.ts`](../apps/api/src/modules/properties/properties.controller.ts))
3. `getPropertyTree` checks Redis first. On a hit, it returns the cached tree immediately. On a
   miss, `assembleTree` builds it from the DB (one query per level, stitched in memory), caches
   it, and returns it.
   ([`hierarchy.service.ts:getPropertyTree`](../apps/api/src/modules/properties/hierarchy.service.ts),
   [`tree-cache.ts:assembleTree`](../apps/api/src/modules/properties/tree-cache.ts))

**Creating a zone — `POST /api/properties/:id/zones`**
1. Route is admin-gated: `authenticate` + `requireRole("HOTEL_ADMIN","SUPER_ADMIN")`, and the body
   is checked by `validateBody(createZoneSchema)`. A supervisor/guard gets **403** here.
2. `createZone` service: confirm the parent property is active (404 if missing, 409 if archived),
   check the zone name is unique among active siblings (409), and — if a `floorId` was given —
   run the **A9** check that the floor belongs to this same property (400 if not).
3. Create the row (tenantId stamped from context), then **invalidate** the property's cached tree
   so the next read rebuilds. Finally `audit.record(...)` logs the action.

---

## 4. Map of the new files

```
apps/api/src/modules/properties/
├── properties.routes.ts     /api/properties routes (reads + property writes + nested creates)
├── hierarchy.routes.ts      /api/buildings, /api/floors, /api/zones (edit/archive + nested creates)
├── properties.controller.ts thin HTTP handlers + Zod schemas
├── hierarchy.service.ts     all the business rules (the heart of 1.1)
└── tree-cache.ts            assemble the tree from the DB + Redis get/set/invalidate
apps/api/src/tests/properties/
├── tree-cache.test.ts       cache + assembly unit tests
├── hierarchy.service.test.ts service invariants (uniqueness, parent checks, A9, archive cascade)
└── hierarchy.http.test.ts   end-to-end over HTTP (authz, tree 404, archive busts cache)
```

The leak suite ([`tests/leak-suite/isolation.test.ts`](../apps/api/src/tests/leak-suite/isolation.test.ts))
and factories were also extended so the three new tables are proven tenant-isolated.

---

## 5. Core concepts (each with its file)

### The property tree cache — `tree-cache.ts`
A property's layout barely changes, so we don't rebuild it on every read. `assembleTree` reads the
active rows and nests them; `getCachedTree`/`setCachedTree` store the JSON in Redis under
`tenant:{tenantId}:proptree:{propertyId}` (note the tenant prefix — one tenant can't read another's
cached tree). `invalidatePropertyTree` deletes that one key, and **every write calls it** for the
property it touched. The 1-hour TTL is only a backstop; correctness comes from explicit invalidation.

### Archive (never destroy) — `hierarchy.service.ts`
Each `archive*` function stamps `archivedAt` instead of deleting, and archives the subtree in one
transaction:
- **archiveProperty** → property + all its buildings, floors, and zones.
- **archiveBuilding** → the building, its floors, and the zones *on those floors* — but **not**
  property-level zones (those don't belong to a building).
- **archiveFloor** → the floor + its zones.
- **archiveZone** → just the zone.

### Parent-must-be-active (404 vs 409) — `hierarchy.service.ts`
When you create something *under* a parent, the rule is uniform across building/floor/zone:
parent missing or in another tenant → **404**; parent exists but is archived → **409**. (You can't
add a floor to an archived building.)

### Active-sibling name uniqueness — `hierarchy.service.ts`
A name must be unique among *active* siblings in the same scope (zone name within a property, floor
name within a building, etc.). Because archived rows are excluded, you can reuse a name after
archiving the old one. On update, the row edits itself out of the check (`exceptId`) so saving
without changing the name doesn't trip "duplicate".

### A9 — zone ↔ floor ↔ property consistency — `hierarchy.service.ts`
If a zone names a `floorId`, that floor's building must belong to the zone's property — otherwise a
"Lobby" zone could point at a floor in a *different* hotel. Violations are **400**. This runs on
both `createZone` and `updateZone` (re-parenting), and is why later `Incident.zoneId` /
`ShiftAssignment.zoneId` data will stay coherent.

### Authorization — reuses Stage 0
Writes are gated by `requireRole("HOTEL_ADMIN","SUPER_ADMIN")` (impersonating platform staff get a
SUPER_ADMIN token, so they pass too). Reads are filtered through `accessiblePropertyIds()`: admins
see all tenant properties, supervisors only their granted ones, and the tree of an un-granted
property returns 404.

---

## 6. How to test Stage 1.1

```bash
npm run db:up                 # MySQL @3307, Redis @6380
npm -w apps/api run test      # full suite — 91 tests, 20 files, all green
```

What the new tests prove:
- **`leak-suite/isolation.test.ts`** — Building/Floor/Zone are tenant-isolated like every other
  table (log in as A → zero B rows).
- **`tree-cache.test.ts`** — the tree assembles correctly (active-only, property vs floor zones),
  and the cache round-trips + invalidates.
- **`hierarchy.service.test.ts`** — name uniqueness, parent 404/409, archive cascade, and A9.
- **`hierarchy.http.test.ts`** — the whole thing over HTTP, including authz (403 for non-admins,
  404 for un-granted tree reads) and "archive busts the cache".

**See it by hand** (after `prisma:migrate` + `seed` + `api:dev`, against `http://acme.lvh.me:3000`
with an admin cookie jar — see the Stage 0 guide's curl section for login):

```bash
# create property → building → floor → zone, then read the tree
PID=$(curl -s -b $JAR -X POST $BASE/api/properties -H 'content-type: application/json' -d '{"name":"HQ"}' | jq -r .data.id)
BID=$(curl -s -b $JAR -X POST $BASE/api/properties/$PID/buildings -H 'content-type: application/json' -d '{"name":"Tower"}' | jq -r .data.id)
FID=$(curl -s -b $JAR -X POST $BASE/api/buildings/$BID/floors -H 'content-type: application/json' -d '{"name":"Ground","level":0}' | jq -r .data.id)
curl -s -b $JAR -X POST $BASE/api/properties/$PID/zones -H 'content-type: application/json' -d "{\"name\":\"Lobby\",\"floorId\":\"$FID\"}"
curl -s -b $JAR $BASE/api/properties/$PID/tree | jq    # nested tree
# archive the zone → it disappears from the next tree read
ZID=$(curl -s -b $JAR $BASE/api/properties/$PID/tree | jq -r '.data.buildings[0].floors[0].zones[0].id')
curl -s -b $JAR -X PATCH $BASE/api/zones/$ZID/archive
curl -s -b $JAR $BASE/api/properties/$PID/tree | jq    # zone gone
```

---

## 7. What 1.1 deliberately does NOT do yet

- **No UI** — backend only; the admin screens to build a hierarchy come in Stage 2.
- **No hard delete** — only archive.
- **No links from incidents/shifts/patrols to zones yet** — those tables arrive in Stage 1.5–1.7;
  1.1 builds only the zone side that they'll later point at (the A9 rule is the groundwork).
- **No analytics/dashboards** — the "Command Center" portfolio view is Stage 4+, and it *reads*
  the data later stages produce; it can't be built before there's data to show.

Next up the checklist: **1.2 — the AuditLog table** (turning the Stage 0 console-only `audit.record`
into a real append-only table).
