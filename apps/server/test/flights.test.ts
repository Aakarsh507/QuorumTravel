import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AddressInfo } from "node:net";
import {
  DESTINATIONS,
  MAX_FLIGHT_OFFERS,
  flightBudgetCap,
  solveGroupPlan,
  type FeasiblePlan,
  type FlightQuery,
  type FlightSearchResult,
  type Preference,
  type ProviderFlightOffer,
} from "@quorum/shared";
import { createApp } from "../src/app";
import {
  DuffelFlightProvider,
  flightProviderFromEnv,
  mapDuffelOffers,
  parseIsoDuration,
  type FlightProvider,
} from "../src/flights";
import { seed, seedPlanning } from "../prisma/seed";

const prisma = new PrismaClient();
let t: Awaited<ReturnType<typeof seedPlanning>>["trips"];
let u: Awaited<ReturnType<typeof seedPlanning>>["users"];
let outsider: string;

/** Start an app with the given flight provider (default: sample), run `fn`, shut it down. */
async function withApp<T>(provider: FlightProvider | undefined, fn: (get: (path: string, user: string | null) => Promise<{ status: number; json: any; text: string }>) => Promise<T>) {
  const server = await createApp({ prisma, flightProvider: provider });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
  try {
    return await fn(async (path, user) => {
      const res = await fetch(base + path, { headers: user ? { "x-user-id": user } : {} });
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, text };
    });
  } finally {
    await server.close();
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await seed(prisma);
  ({ trips: t, users: u } = await seedPlanning(prisma));
  outsider = (await prisma.user.create({ data: { displayName: "Outsider" } })).id;
});

/** A trip whose plan the group has already confirmed, solved for one destination. */
async function confirmedTrip(name: string, airport: string, members: { name: string; pref: Preference }[]) {
  const trip = await prisma.trip.create({ data: { name } });
  const ids: string[] = [];
  for (const [i, m] of members.entries()) {
    const user = await prisma.user.create({ data: { displayName: m.name } });
    ids.push(user.id);
    await prisma.tripMember.create({ data: { tripId: trip.id, userId: user.id, role: i === 0 ? "CREATOR" : "MEMBER" } });
    await prisma.preference.create({
      data: {
        tripId: trip.id,
        userId: user.id,
        dateRanges: JSON.stringify(m.pref.dateRanges),
        maxBudgetUsd: m.pref.maxBudgetUsd,
        departureAirport: m.pref.departureAirport,
        tags: JSON.stringify(m.pref.tags),
      },
    });
  }
  const result = solveGroupPlan(
    members.map((m, i) => ({ memberId: ids[i]!, ...m.pref })),
    DESTINATIONS.filter((d) => d.airport === airport),
  );
  expect(result.feasible).toBe(true);
  await prisma.groupPlan.create({ data: { tripId: trip.id, status: "CONFIRMED", result: JSON.stringify(result), createdById: ids[0]! } });
  return { tripId: trip.id, userIds: ids };
}

const pref = (departureAirport: string, maxBudgetUsd: number, start: string, end: string): Preference => ({
  dateRanges: [{ start, end }],
  maxBudgetUsd,
  departureAirport,
  tags: ["food"],
});

describe("SYS-03 flight search API", () => {
  it("FR-301: 10 searches; every offer matches the member's airport, plan dates and cap, cheapest first", async () => {
    const denver = await confirmedTrip("Denver Ski Trip", "DEN", [
      { name: "Sea", pref: pref("SEA", 1900, "2027-01-08", "2027-01-14") },
      { name: "Bos", pref: pref("BOS", 2000, "2027-01-09", "2027-01-15") },
      { name: "Dfw", pref: pref("DFW", 1700, "2027-01-07", "2027-01-13") },
    ]);
    const miami = await confirmedTrip("Miami Weekend", "MIA", [
      { name: "Lax", pref: pref("LAX", 2100, "2027-04-01", "2027-04-05") },
      { name: "Phl", pref: pref("PHL", 1500, "2027-04-02", "2027-04-06") },
      { name: "Msp", pref: pref("MSP", 1600, "2027-04-01", "2027-04-04") },
    ]);
    const searches = [
      ...[u.alex, u.maya, u.sam, u.priya].map((userId) => ({ tripId: t.nash, userId })),
      ...denver.userIds.map((userId) => ({ tripId: denver.tripId, userId })),
      ...miami.userIds.map((userId) => ({ tripId: miami.tripId, userId })),
    ];
    expect(searches).toHaveLength(10);

    await withApp(undefined, async (get) => {
      for (const { tripId, userId } of searches) {
        const plan = (await prisma.groupPlan.findUniqueOrThrow({ where: { tripId } }));
        const result = JSON.parse(plan.result) as FeasiblePlan;
        const p = await prisma.preference.findUniqueOrThrow({ where: { tripId_userId: { tripId, userId } } });
        const cap = flightBudgetCap(p.maxBudgetUsd, result);

        const r = await get(`/trips/${tripId}/flights/me`, userId);
        expect(r.status).toBe(200);
        const body = r.json as FlightSearchResult;
        expect(body).toMatchObject({
          origin: p.departureAirport,
          destination: result.destination.airport,
          departDate: result.startDate,
          returnDate: result.endDate,
          capUsd: cap,
          source: "sample",
          simulated: true,
        });
        expect(body.offers.length).toBeGreaterThan(0);
        expect(body.offers.length).toBeLessThanOrEqual(MAX_FLIGHT_OFFERS);
        for (const o of body.offers) {
          expect(o.outbound.from).toBe(p.departureAirport);
          expect(o.outbound.to).toBe(result.destination.airport);
          expect(o.outbound.departAt.slice(0, 10)).toBe(result.startDate);
          expect(o.inbound.from).toBe(result.destination.airport);
          expect(o.inbound.to).toBe(p.departureAirport);
          expect(o.inbound.departAt.slice(0, 10)).toBe(result.endDate);
          expect(o.priceUsd).toBeLessThanOrEqual(cap);
        }
        const prices = body.offers.map((o) => o.priceUsd);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
      }
    });
  });

  it("FR-301: whatever the provider returns, the route keeps only valid offers under the cap", async () => {
    const good = (id: string, amount: number, q: FlightQuery): ProviderFlightOffer => ({
      id,
      airline: { code: "ZZ", name: "Test Air" },
      totalAmount: amount,
      currency: "USD",
      outbound: { from: q.origin, to: q.destination, departAt: `${q.departDate}T08:00:00`, arriveAt: `${q.departDate}T10:00:00`, stops: 0, durationMinutes: 120 },
      inbound: { from: q.destination, to: q.origin, departAt: `${q.returnDate}T08:00:00`, arriveAt: `${q.returnDate}T10:00:00`, stops: 0, durationMinutes: 120 },
    });
    const messy: FlightProvider = {
      source: "duffel",
      simulated: false, // behaves like a live token
      async search(q) {
        return [
          good("cheap", 120, q),
          good("way-over", 99_999, q),
          { ...good("eur", 50, q), currency: "EUR" },
          { ...good("other-airport", 60, q), outbound: { ...good("x", 0, q).outbound, from: "ZZZ" } },
        ];
      },
    };
    await withApp(messy, async (get) => {
      const r = await get(`/trips/${t.nash}/flights/me`, u.alex);
      expect(r.status).toBe(200);
      expect(r.json.source).toBe("duffel");
      expect(r.json.simulated).toBe(false);
      expect(r.json.offers.map((o: { id: string }) => o.id)).toEqual(["cheap"]);
    });
  });

  it("FR-103: a member's search holds none of the other members' airports or budgets", async () => {
    const others = await prisma.preference.findMany({ where: { tripId: t.nash, userId: { not: u.alex } } });
    await withApp(undefined, async (get) => {
      const r = await get(`/trips/${t.nash}/flights/me`, u.alex);
      expect(r.status).toBe(200);
      for (const o of others) {
        expect(r.text).not.toContain(`"${o.departureAirport}"`);
        expect(r.text).not.toContain(String(o.maxBudgetUsd));
      }
      // Only "/me" exists: there is no route that takes another member's id.
      expect((await get(`/trips/${t.nash}/flights/${u.maya}`, u.alex)).status).toBe(404);
    });
  });

  it("checks the caller, membership, plan status and preferences", async () => {
    const failing: FlightProvider = { source: "duffel", simulated: true, search: async () => { throw new Error("boom"); } };
    await withApp(undefined, async (get) => {
      expect((await get(`/trips/${t.nash}/flights/me`, null)).status).toBe(401);
      expect((await get(`/trips/${t.nash}/flights/me`, outsider)).status).toBe(403);
      // Miami is still collecting preferences; Asheville's plan is infeasible.
      expect((await get(`/trips/${t.miami}/flights/me`, u.maya)).status).toBe(409);
      expect((await get(`/trips/${t.ash}/flights/me`, u.alex)).status).toBe(409);
      // Confirmed trip, but this member never submitted preferences.
      await prisma.preference.delete({ where: { tripId_userId: { tripId: t.nash, userId: u.sam } } });
      const r = await get(`/trips/${t.nash}/flights/me`, u.sam);
      expect(r.status).toBe(409);
      expect(r.json.error).toMatch(/preferences/);
    });
    await withApp(failing, async (get) => {
      const r = await get(`/trips/${t.nash}/flights/me`, u.alex);
      expect(r.status).toBe(502);
      expect(r.text).not.toContain("boom");
    });
  });
});

describe("SYS-03 Duffel provider", () => {
  const segment = (from: string, to: string, dep: string, arr: string) => ({
    origin: { iata_code: from },
    destination: { iata_code: to },
    departing_at: dep,
    arriving_at: arr,
  });
  // Trimmed from the shape of a Duffel v2 offer-request response.
  const response = {
    data: {
      offers: [
        {
          id: "off_1",
          total_amount: "212.40",
          total_currency: "USD",
          owner: { iata_code: "ZZ", name: "Duffel Airways" },
          slices: [
            { duration: "PT1H5M", segments: [segment("IND", "BNA", "2027-05-21T07:15:00", "2027-05-21T07:20:00")] },
            { duration: "PT4H10M", segments: [segment("BNA", "ATL", "2027-05-25T12:00:00", "2027-05-25T14:05:00"), segment("ATL", "IND", "2027-05-25T15:30:00", "2027-05-25T17:10:00")] },
          ],
        },
        { id: "off_bad", total_amount: "10", total_currency: "USD", owner: { iata_code: "ZZ", name: "X" }, slices: [] },
      ],
    },
  };

  it("maps offers (airline, price, both slices, stops) and skips malformed ones", () => {
    expect(mapDuffelOffers(response)).toEqual([
      {
        id: "off_1",
        airline: { code: "ZZ", name: "Duffel Airways" },
        totalAmount: 212.4,
        currency: "USD",
        // 07:15 Eastern -> 07:20 Central looks like 5 minutes; Duffel's duration says 1h 5m.
        outbound: { from: "IND", to: "BNA", departAt: "2027-05-21T07:15:00", arriveAt: "2027-05-21T07:20:00", stops: 0, durationMinutes: 65 },
        inbound: { from: "BNA", to: "IND", departAt: "2027-05-25T12:00:00", arriveAt: "2027-05-25T17:10:00", stops: 1, durationMinutes: 250 },
      },
    ]);
    expect(mapDuffelOffers({})).toEqual([]);
  });

  it("parses Duffel's ISO 8601 durations into minutes", () => {
    expect(parseIsoDuration("PT1H7M")).toBe(67);
    expect(parseIsoDuration("PT45M")).toBe(45);
    expect(parseIsoDuration("PT3H")).toBe(180);
    expect(parseIsoDuration("P1DT2H30M")).toBe(1590);
    for (const bad of [null, undefined, "", "P", "PT", "1H", "PT1.5H"]) expect(parseIsoDuration(bad)).toBeNull();
  });

  it("sends a round-trip offer request with the token and Duffel-Version header", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify(response), { status: 201 });
    }) as unknown as typeof fetch;
    const provider = new DuffelFlightProvider("duffel_test_abc", fakeFetch);
    const offers = await provider.search({ origin: "IND", destination: "BNA", departDate: "2027-05-21", returnDate: "2027-05-25" });
    expect(offers).toHaveLength(1);
    expect(sent!.url).toContain("https://api.duffel.com/air/offer_requests");
    const headers = sent!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer duffel_test_abc");
    expect(headers["Duffel-Version"]).toBe("v2");
    expect(JSON.parse(sent!.init.body as string).data.slices).toEqual([
      { origin: "IND", destination: "BNA", departure_date: "2027-05-21" },
      { origin: "BNA", destination: "IND", departure_date: "2027-05-25" },
    ]);
  });

  it("flags test-token and sample results as simulated, live-token results as real", () => {
    expect(new DuffelFlightProvider("duffel_test_abc").simulated).toBe(true);
    expect(new DuffelFlightProvider("duffel_live_abc").simulated).toBe(false);
    expect(flightProviderFromEnv({ DUFFEL_TOKEN: "duffel_test_abc" })).toMatchObject({ source: "duffel", simulated: true });
    expect(flightProviderFromEnv({ DUFFEL_TOKEN: "  " })).toMatchObject({ source: "sample", simulated: true });
    expect(flightProviderFromEnv({})).toMatchObject({ source: "sample", simulated: true });
  });

  it("throws on an HTTP error without leaking the token", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const err = await new DuffelFlightProvider("duffel_test_secret", fakeFetch)
      .search({ origin: "IND", destination: "BNA", departDate: "2027-05-21", returnDate: "2027-05-25" })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("secret");
  });
});
