# SYS-03 Flight Search — Implementation Plan

**Owner:** Zachary Krause · **Branch:** `feat/sys-03-flight-search` (from `main`) · **Status:** approved, in progress

## 1. Goal

Replace the "Flights — coming next" placeholder with a working flight search. Once the group plan is confirmed, each member sees their own cheapest round trips and can open a booking page for any of them.

| Requirement | What it demands | Test method (from the SDP) |
|---|---|---|
| FR-301 | When a plan is confirmed, query the flight provider for round trips from **each member's** departure airport on the plan dates. Show up to 10 lowest-priced options within **that member's** budget cap | 10 searches; every result matches the member's airport and dates and is at or below the cap |
| FR-303 | When a member selects an option, open the provider's booking page for that option and dates | Open 20 booking links; each opens the selected route and dates |
| FR-103 (still applies) | No member sees another member's private values | Search response holds only the caller's own data |

Lodging search (FR-302, the Stays tab) is a separate task.

## 2. Decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Provider** | A `FlightProvider` interface with two implementations. **Duffel** (test mode) when `DUFFEL_TOKEN` is set in `apps/server/.env`. Otherwise a deterministic **sample provider** that builds offers from the solver's distance-based airfare estimate. Automated tests always use the sample provider, so CI needs no token or network |
| 2 | **Budget cap** | Flight cap = member's `maxBudgetUsd` − (nights × destination lodging per night + (nights + 1) × daily spend). These are the same estimates the solver used, so a member who books a flight under the cap still fits the trip budget the solver promised |
| 3 | **Booking link (FR-303)** | Duffel has no public booking pages, so "Book" opens a **Google Flights** search pre-filled with that exact route and dates (`?q=Flights to BNA from IND on 2027-05-21 through 2027-05-25`). The member picks the flight and pays there. Opens in a new tab. **Revised during manual testing:** the first version also named the airline, and Google ignored the whole query; this wording was checked by hand to fill in both airports and both dates. Duffel test-mode airlines and schedules are simulated, so they will not appear on Google anyway |
| 4 | **The server enforces the rules** | Whatever the provider returns, the server keeps only offers matching origin, destination and dates that are at or below the cap. It sorts them by price and keeps the first 10. That logic is a pure function in `packages/shared`, unit tested on its own |
| 5 | **Currency** | Caps are in USD. Duffel offers in another currency are dropped rather than converted at a guessed rate |
| 6 | **Provider failure** | Duffel error or timeout → HTTP 502 "Flight search is unavailable right now". The page shows this. We don't quietly fall back to sample data, because that would show made-up prices as if they were real |
| 7 | **No storage** | Searches run on request. Nothing is added to the database schema |

## 3. Design

### 3.1 Files

| File | Change |
|---|---|
| `packages/shared/src/flights.ts` (new) | `FlightOffer` type, `flightBudgetCap`, `selectFlightOffers` (filter / sort / top 10), `googleFlightsUrl`, `sampleFlightOffers` (deterministic generator) |
| `packages/shared/src/flights.test.ts` (new) | Unit tests |
| `apps/server/src/flights.ts` (new) | `FlightProvider` interface, `SampleFlightProvider`, `DuffelFlightProvider`, `GET /trips/:tripId/flights/me` route |
| `apps/server/src/app.ts`, `main.ts` | Accept a `flightProvider` option. `main.ts` picks Duffel when `DUFFEL_TOKEN` is set |
| `apps/server/test/flights.test.ts` (new) | API tests |
| `apps/web/src/pages/FlightsPage.tsx` (new), `api.ts`, `main.tsx` | Flights page replaces the placeholder |
| `apps/server/.env.example`, `README.md` | Document `DUFFEL_TOKEN` and the new feature |

### 3.2 API

`GET /trips/:tripId/flights/me`. As with preferences, there is deliberately no route for another member's flights.

| Case | Response |
|---|---|
| No / unknown user | 401 |
| Not a member | 403 |
| Plan not confirmed | 409 "Flights open once the group plan is confirmed" |
| Caller has no preferences | 409 "Add your travel preferences first" |
| Provider failed | 502 |
| OK | `{ origin, destination, departDate, returnDate, capUsd, source: "duffel" \| "sample", offers: FlightOffer[] }` |

`FlightOffer`: `id, airline {code, name}, priceUsd, outbound {from, to, departAt, arriveAt, stops, durationMinutes}, inbound {…}, bookingUrl`.

### 3.3 Duffel

`POST https://api.duffel.com/air/offer_requests?return_offers=true` with headers `Duffel-Version: v2`, `Authorization: Bearer <token>`. Two slices (out and back), one adult per search, economy, `max_connections: 1`. Map `total_amount` / `total_currency`, `owner` (airline) and the first and last segment of each slice. The response mapping is unit tested against a saved sample response, so no live call is needed.

### 3.4 Page

- Header: route (e.g. IND → BNA), dates, and "Your flight budget: $X". That figure is private, shown with the existing privacy banner.
- Up to 10 cards: airline, outbound and return times (local to each airport), flight length, stops, price, and a **Book on Google Flights** button.
- Empty and error states: plan not confirmed (link to Group plan), no preferences (link to My preferences), no flights under the cap, provider unavailable.
- A "prices and schedules are simulated" label whenever the data is not real (sample provider, or a `duffel_test_` token), so nobody mistakes it for live prices or searches Google for a flight that does not exist. The server reports this as `simulated` in the response.

## 4. Test plan

**Automated** (`npm test`; test names carry the requirement ID):

| ID | Test |
|---|---|
| FR-301 | 10 searches (every member of the confirmed Nashville trip plus generated confirmed trips from different airports). Every offer: origin = member's airport, destination = plan airport, dates = plan dates, price ≤ cap; at most 10; sorted by price |
| FR-301 | `selectFlightOffers` drops wrong-airport, wrong-date, over-cap and non-USD offers from a mixed list, and keeps the 10 cheapest |
| FR-301 | `flightBudgetCap` equals budget − lodging − daily spend for known inputs; a cap at or below zero returns no offers |
| FR-303 | 20 generated offers: each `bookingUrl` is a Google Flights URL for that offer's origin, destination and both dates, in the wording verified by hand |
| FR-103 | Alex's response contains none of the other Nashville members' airports or budgets. There is no route for another member's flights |
| Access | 401 with no user, 403 for an outsider, 409 before the plan is confirmed, 409 without preferences, 502 when the provider throws |
| Duffel mapping | A saved Duffel response maps to `FlightOffer`s correctly |

**Manual:**
- Run the app as Alex → Nashville Reunion → Flights. Screenshot the results, then switch "Viewing as" to Maya and check the airport and cap change.
- Click 5 booking links and confirm Google Flights opens with the right route and dates.
- With `DUFFEL_TOKEN` set: repeat the page check and confirm the "Sample data" label is gone.

**Done when:** `npm run typecheck` and `npm test` pass, and the existing tests still pass.
