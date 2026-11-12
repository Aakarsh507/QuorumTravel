# QuorumTravel

Group trip planning (ECE 49595 SD I, Team 11).

Aakarsh Gupta · Dylan Patel · Roshan Patel · Zachary Krause

**How we work:** branching, PR and review rules are in [doc/DEVELOPMENT_PROCESS.md](doc/DEVELOPMENT_PROCESS.md).

## What is built so far

**Workflow 1 prototype — Group Trip Planning (SYS-01 + SYS-02)** (FR-101, FR-102, FR-103, FR-201, FR-202, FR-203, NFR-201). Matches the six "Design A" Figma screens:

| # | Screen | Route | API it calls |
|---|---|---|---|
| 1 | Your trips | `/` | `GET /me/trips` |
| 2 | Create trip → Invite members → Review | `/trips/new`, `/trips/:id/setup/invite`, `/setup/review` | `POST /trips`, `POST /trips/:id/invites`, `POST /join/:code` |
| 3 | My travel preferences (private) | `/trips/:id/preferences` | `GET`/`PUT /trips/:id/preferences/me` |
| 4 | Ready to generate | `/trips/:id/plan` | `GET /trips/:id/readiness` |
| 5 | Review and vote | `/trips/:id/plan` | `POST /trips/:id/plan/generate` (runs the solver), `POST /plan/vote` |
| 6 | Majority approved | `/trips/:id/plan` | `GET /trips/:id/plan` |

- **Group plan solver** (`packages/shared/src/planning.ts`): finds the longest window when everyone is free, keeps only destinations whose estimated cost (distance-based airfare + lodging + daily spend) fits **every** member's budget, then scores them by shared preference tags. If nothing fits, it says whether **dates** or **budget** is the conflict and suggests a fix, without revealing anyone's private values.
- Preferences are validated by one zod schema used in **both** the browser and the server (field-level errors, bundled IATA airport list).
- No API route returns another member's preferences. Readiness only shows who has submitted.
- Majority vote (more than half of members) confirms or rejects the plan. The plan page polls every 3 s, so votes from other windows appear without a reload.
- Flights / Stays tabs are placeholders for SYS-03.

**SYS-04 Shared Itinerary** (FR-401, FR-402, FR-405, NFR-401, NFR-403). Plan: [doc/SYS-04-itinerary-plan.md](doc/SYS-04-itinerary-plan.md).

- Chronological itinerary of flights, lodging and activities, synced live to every member (Socket.IO).
- Overlap flagging (lodging only conflicts with other lodging).
- Role-based editing: the trip creator edits and confirms; the creator can grant edit rights; other members **propose** items (shown in a lighter shade until confirmed).
- Stale edits get HTTP 409 instead of overwriting someone else's change.

Authentication (SYS-07) is **not** built yet. `apps/server/src/auth.ts` holds a dev-only stand-in (`x-user-id` header and a "Viewing as" switcher in the UI). Replace `resolveUser` with real session lookup when SYS-07 lands.

## Layout

```
packages/shared   types, validation, group plan solver, sort / conflict / hash logic (web + server)
apps/server       Fastify API + Socket.IO + Prisma (SQLite in dev)
apps/web          React + Vite + React Router: Workflow 1 pages + itinerary
doc/              development process, SDP, plans
```

## Setup

Requires Node 20+.

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run setup          # creates apps/server/prisma/dev.db and seeds the demo trips
npm run dev:server     # API on http://localhost:3001
npm run dev:web        # UI  on http://localhost:5173
```

If you already had a `dev.db` from before the planning tables existed, `npm run setup` will refuse to change it. Delete `apps/server/prisma/dev.db` (demo data only) and run it again.

**Workflow 1 demo:** you start as *Alex Rivera*. Open *Miami Spring Break 2027* → Add my preferences (e.g. Mar 12–20, $1500, IND, Nightlife + Food) → Generate group plan → Accept. Switch "Viewing as" to Maya and then Jordan and accept as each: the third approval confirms the plan.

**Itinerary demo:** switch to *Ada (creator)* and open *Lisbon Getaway* → Itinerary. Open a second window as another member to watch edits sync.

## Tests

```bash
npm test               # shared unit tests + server API / permission / real-time tests
npm run typecheck
```

Server tests use a throwaway `prisma/test.db`, never `dev.db`.

| Requirement | Covered by |
|---|---|
| FR-101 | 5 users submit; stored record matches every field |
| FR-102 | 15 invalid inputs (5 per error type) rejected with field errors; API stores nothing |
| FR-103 | 20 attempts to read another member's constraints denied; responses contain no private values |
| FR-201 | 20 synthetic feasible groups: plan meets every member's dates and budget |
| FR-202 | 10 infeasible groups: conflict type named, no private values in the report |
| FR-203 | groups of 3–6: majority confirms, fewer does not; rejecting majority rejects; voting closes |
| NFR-201 | 50 synthetic groups of 2–10, p95 solver time under 10 s |
| FR-401 | seeded fixture loaded by 3 members x 5 runs, chronological order |
| FR-402 | 10 trials, 2 other sessions, each under 5 s |
| NFR-401 | 10 clients, 20 updates, p95 under 5 s |
| NFR-403 | 4 clients, 10 sync events, identical hashes |
| FR-405 | unit tests (overlap, back-to-back, lodging rule, removal) and API check |
| Permissions / access | role table, non-member 403, socket refusal, 409 on stale edit, validation |

## Desktop interface integration

The planning workflow uses the laptop/web layout from [Proposed UI/UX](https://www.figma.com/make/PS0sE9rDcH031bP6FGxSmK/Proposed-UI-UX): the trip dashboard, setup wizard, sidebar, overview, private preferences, readiness, conflict, voting, and approval screens. The original destination photographs and favicon are stored under `apps/web/public`. Shared presentation components are in `components/Design.tsx`; `figma.css` contains the exported design rules and `integration.css` adapts the existing controls.

The screens read and write the existing API. Trip counts, readiness, estimates, and vote totals come from server data. The Figma export's hardcoded trips and local-storage planner are not used. Destinations without a supplied photograph have a neutral cover. The existing demo-user switcher remains available for testing collaboration; production authentication is still pending. Flights, Stays, Explore, AI Assistant, and Expenses are visible navigation destinations with explicit placeholder pages. The existing shared itinerary keeps its real-time and permission behavior within the new shell. Mobile layout work is outside this change.
