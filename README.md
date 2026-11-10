# QuorumTravel

Group trip planning (ECE 49595 SD I, Team 11).

Aakarsh Gupta · Dylan Patel · Roshan Patel · Zachary Krause

## What is built so far

**SYS-04 Shared Itinerary** (FR-401, FR-402, FR-405, NFR-401, NFR-403). Plan: [docs/SYS-04-itinerary-plan.md](docs/SYS-04-itinerary-plan.md).

- Chronological itinerary of flights, lodging and activities, synced live to every member (Socket.IO).
- Overlap flagging (lodging only conflicts with other lodging).
- Role-based editing: the trip creator edits and confirms; the creator can grant edit rights; other members **propose** items (shown in a lighter shade until confirmed).
- Stale edits get HTTP 409 instead of overwriting someone else's change.

Authentication (SYS-07) is **not** built yet. `apps/server/src/auth.ts` holds a dev-only stand-in (`x-user-id` header and a "Viewing as" switcher in the UI). Replace `resolveUser` with real session lookup when SYS-07 lands.

## Layout

```
packages/shared   types, validation, sort / conflict / hash logic (web + server)
apps/server       Fastify API + Socket.IO + Prisma (SQLite in dev)
apps/web          React + Vite itinerary page
docs/             project documents and the SYS-04 plan
```

## Setup

Requires Node 20+.

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run setup          # creates apps/server/prisma/dev.db and seeds the demo trip
npm run dev:server     # API on http://localhost:3001
npm run dev:web        # UI  on http://localhost:5173
```

Open the UI in two browser windows, pick different people under "Viewing as", and edit as the creator to watch the other window update.

## Tests

```bash
npm test               # shared unit tests + server API / permission / real-time tests
npm run typecheck
```

Server tests use a throwaway `prisma/test.db`, never `dev.db`.

| Requirement | Covered by |
|---|---|
| FR-401 | seeded fixture loaded by 3 members x 5 runs, chronological order |
| FR-402 | 10 trials, 2 other sessions, each under 5 s |
| NFR-401 | 10 clients, 20 updates, p95 under 5 s |
| NFR-403 | 4 clients, 10 sync events, identical hashes |
| FR-405 | unit tests (overlap, back-to-back, lodging rule, removal) and API check |
| Permissions / access | role table, non-member 403, socket refusal, 409 on stale edit, validation |
