# SYS-04 Shared Itinerary — Implementation Plan

**Owner:** Aakarsh Gupta · **Branch:** `feat/itinerary` · **Status:** awaiting approval (nothing committed)

## 1. Goal

Build the shared itinerary: one synced, chronological view of a trip's flights, lodging and activities that every member sees identically.

| Requirement | What it demands |
|---|---|
| FR-401 | Show all confirmed flights, lodging and activities in chronological order |
| FR-402 | A change reaches all other members within 5 s |
| FR-405 | Visually flag both items when two overlap for the same member |
| NFR-401 | 95th-percentile sync latency under 5 s for groups up to 10 |
| NFR-403 | After sync, every member's itinerary is identical |

## 2. Decisions (agreed with the team owner)

| # | Decision | Detail |
|---|---|---|
| 1 | **Stack** | React + Vite + TypeScript (web), Node + Fastify + Socket.IO (server), Prisma with SQLite locally and Postgres when deployed, Vitest for tests |
| 2 | **Lodging overlaps** | Lodging conflicts only with other lodging. Flights and activities are checked against each other. Back-to-back items (one ends exactly when the next starts) do not conflict |
| 3 | **Edit rights (role-based)** | Only the **trip creator** can add, edit, confirm and delete items. The creator can **grant edit permission** to individual members. Every other member can only **propose** items, and edit or withdraw their own proposals |
| 4 | **Proposed items** | Shown on the itinerary in a **lighter shade** with a "Proposed" label. A creator or permitted editor confirms or rejects them |
| 5 | **Commit** | **One commit** when everything is built and tests pass |

## 3. Scope

**In scope**
- Itinerary data model, API, real-time sync, conflict flagging and UI
- Creator / editor / member permissions for itinerary items
- Seed data matching the SDP fixture (2 flights, 1 lodging, 3 activities)
- Automated tests for every requirement in section 1

**Out of scope (other tasks)**
- Real login (SYS-07). A dev-only stand-in identifies the user; it sits behind one function (`resolveUser`) so real sessions replace it without touching the itinerary code
- Creating trips and inviting members (seeded for now)
- Pulling bookings in from flight and hotel search (SYS-03)
- Offline view (SYS-09), calendar export (SYS-10)

## 4. Design

### 4.1 Project layout
```
packages/shared   types, validation, sort / conflict / hash logic (used by web and server)
apps/server       Fastify API + Socket.IO + Prisma
apps/web          React itinerary page
```

### 4.2 Data model
| Table | Key fields |
|---|---|
| `User` | id, displayName |
| `Trip` | id, name, `version` (increases on every itinerary change) |
| `TripMember` | tripId, userId, `role` (CREATOR or MEMBER), `canEdit` (granted by creator) |
| `ItineraryItem` | id, tripId, type (FLIGHT, LODGING, ACTIVITY), title, startAt, endAt (UTC), timezone, location, `status` (CONFIRMED or PROPOSED), `version`, participantIds (empty = whole group), createdById, lastEditedById |

### 4.3 Permissions
| Action | Creator | Member with edit permission | Other member |
|---|---|---|---|
| View itinerary | Yes | Yes | Yes |
| Add item | Confirmed | Confirmed | **Proposed** only |
| Edit / delete any item | Yes | Yes | No |
| Edit / withdraw own proposal | Yes | Yes | Yes |
| Confirm or reject a proposal | Yes | Yes | No |
| Grant or revoke edit permission | Yes | No | No |
| Non-member (any action) | Refused (403) | | |

All checks run on the server; the UI only hides buttons the user can't use.

### 4.4 API
| Route | Purpose |
|---|---|
| `GET /trips/:tripId/itinerary` | Snapshot, the caller's permissions, member list |
| `POST /trips/:tripId/items` | Add an item (confirmed or proposed, by role) |
| `PATCH /trips/:tripId/items/:itemId` | Edit or confirm. Requires the item's `expectedVersion`; a stale edit gets **409** instead of overwriting |
| `DELETE /trips/:tripId/items/:itemId` | Delete an item or withdraw a proposal |
| `PATCH /trips/:tripId/members/:userId` | Creator grants or revokes edit permission |

### 4.5 Real-time sync
- One Socket.IO room per trip. The server verifies trip membership before a client may join.
- After every saved change the server sends the **full snapshot** to the room: sorted items, conflict ids, trip version and a SHA-256 hash.
- A client that connects or reconnects receives the current snapshot immediately.
- Each client recomputes the hash of what it shows and compares it with the server's. This is the NFR-403 proof.

### 4.6 Core logic (shared, pure functions)
- `sortItinerary`: by start, then end, then id, so order is identical everywhere.
- `findConflicts`: items conflict when they share a member and their times intersect, with the lodging rule from decision 2. Proposed items are checked too, so the creator sees a clash before confirming.
- `hashItinerary`: stable JSON form, hashed with SHA-256.

### 4.7 UI
- Day-by-day timeline; times shown in each item's own time zone.
- Confirmed items in full colour; proposed items lighter, with Confirm / Reject for those allowed.
- Red conflict badge on both overlapping items; clears when the overlap is removed.
- Add / edit form; "Live" connection indicator; "last edited by" on each item.
- Members panel where the creator toggles edit permission.
- A dev-only user switcher (stand-in for login) to demo several members.
- Labels, keyboard navigation and visible focus (WCAG 2.2).

## 5. Test plan (decided before building)

| Requirement | Test | Pass condition |
|---|---|---|
| FR-401 | Seed 6 items; load as 3 members, 5 runs | All 6 present, chronological, every time |
| FR-402 | Change an item from one session; time arrival on 2 others; 10 trials | Under 5 s in at least 9 of 10 |
| NFR-401 | 10 simulated clients, 20 updates | 95th-percentile latency under 5 s |
| NFR-403 | Hash every client's itinerary after 10 sync events | 100% identical |
| FR-405 | Overlapping and non-overlapping pairs, lodging rule, removal | Flag only on overlaps; clears on removal |
| Permissions | Each row of the table in 4.3, via the API | Allowed actions succeed; others get 403 |
| Access control | Non-member calls the API and tries to join the socket room | 403 / connection refused |
| Concurrency | Two edits of the same item with the same version | Second gets 409; first edit preserved |
| Validation | End before start, empty title, non-member participant | 400, nothing stored |

Plus a manual check: two browser windows as different members, edit in one, watch the other update.

## 6. Build order

1. Scaffold the three packages; install dependencies.
2. Shared logic and its unit tests.
3. Database schema and seed.
4. Server API with permissions.
5. Socket.IO sync.
6. Server tests (section 5).
7. Web UI.
8. Manual two-window check and screenshots.
9. README setup steps, then **one commit** on `feat/itinerary`. Pushing to GitHub happens only after you review the diff.

## 7. Open questions

1. Should **proposed** items count toward conflict flags (current plan: yes), or only confirmed ones?
2. When a proposal is **rejected**, delete it (current plan) or keep it visible as "rejected"?
3. May a member with edit permission also **grant** permission to others (current plan: no, creator only)?
