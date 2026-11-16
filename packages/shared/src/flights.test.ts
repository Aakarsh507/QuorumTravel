import { describe, expect, it } from "vitest";
import {
  DAILY_SPEND,
  MAX_FLIGHT_OFFERS,
  flightBudgetCap,
  googleFlightsUrl,
  sampleFlightOffers,
  selectFlightOffers,
  type FlightQuery,
  type ProviderFlightOffer,
} from "./index";

const q: FlightQuery = { origin: "IND", destination: "BNA", departDate: "2027-05-21", returnDate: "2027-05-25" };

function offer(id: string, totalAmount: number, over: Partial<ProviderFlightOffer> = {}): ProviderFlightOffer {
  return {
    id,
    airline: { code: "AA", name: "American Airlines" },
    totalAmount,
    currency: "USD",
    outbound: { from: "IND", to: "BNA", departAt: "2027-05-21T08:00:00", arriveAt: "2027-05-21T08:10:00", stops: 0, durationMinutes: 70 },
    inbound: { from: "BNA", to: "IND", departAt: "2027-05-25T17:00:00", arriveAt: "2027-05-25T19:05:00", stops: 0, durationMinutes: 65 },
    ...over,
  };
}

describe("FR-301 flight budget cap", () => {
  it("is the trip budget minus the solver's lodging and daily-spend estimate", () => {
    // Nashville lodging is $80/night: 4 nights = 320, 5 days of spend = 300.
    expect(flightBudgetCap(1200, { destination: { airport: "BNA" }, nights: 4 })).toBe(1200 - 320 - 5 * DAILY_SPEND);
  });

  it("never goes below zero", () => {
    expect(flightBudgetCap(100, { destination: { airport: "JFK" }, nights: 5 })).toBe(0);
  });
});

describe("FR-301 selecting offers", () => {
  it("drops wrong airports, wrong dates, over-cap and non-USD offers", () => {
    const outbound = offer("x", 0).outbound;
    const inbound = offer("x", 0).inbound;
    const mixed = [
      offer("ok", 200),
      offer("over-cap", 501),
      offer("at-cap", 500),
      offer("gbp", 150, { currency: "GBP" }),
      offer("wrong-origin", 150, { outbound: { ...outbound, from: "ORD" } }),
      offer("wrong-dest", 150, { outbound: { ...outbound, to: "MIA" } }),
      offer("wrong-out-date", 150, { outbound: { ...outbound, departAt: "2027-05-22T08:00:00" } }),
      offer("wrong-back-date", 150, { inbound: { ...inbound, departAt: "2027-05-24T17:00:00" } }),
      offer("wrong-back-airport", 150, { inbound: { ...inbound, to: "CVG" } }),
      offer("nan", Number.NaN),
    ];
    expect(selectFlightOffers(mixed, q, 500).map((o) => o.id)).toEqual(["ok", "at-cap"]);
  });

  it("keeps only the 10 cheapest, sorted by price", () => {
    const many = Array.from({ length: 25 }, (_, i) => offer(`o${i}`, 400 - i * 10));
    const picked = selectFlightOffers(many, q, 1000);
    expect(picked).toHaveLength(MAX_FLIGHT_OFFERS);
    expect(picked.map((o) => o.priceUsd)).toEqual([160, 170, 180, 190, 200, 210, 220, 230, 240, 250]);
  });

  it("returns nothing when the cap is zero", () => {
    expect(selectFlightOffers([offer("a", 1)], q, 0)).toEqual([]);
  });
});

describe("FR-301 sample provider", () => {
  it("is deterministic and spreads prices around the estimate", () => {
    const a = sampleFlightOffers(q);
    expect(a).toEqual(sampleFlightOffers(q));
    expect(a.length).toBeGreaterThan(MAX_FLIGHT_OFFERS);
    const prices = a.map((o) => o.totalAmount);
    expect(Math.max(...prices)).toBeGreaterThan(Math.min(...prices) * 1.5);
  });

  it("only produces offers that match the query", () => {
    const all = sampleFlightOffers(q);
    expect(selectFlightOffers(all, q, Number.MAX_SAFE_INTEGER)).toHaveLength(MAX_FLIGHT_OFFERS);
    expect(all.every((o) => o.currency === "USD" && o.outbound.departAt.startsWith(q.departDate))).toBe(true);
    // Every leg has a length, and connections take longer than the nonstop flight.
    for (const o of all) for (const s of [o.outbound, o.inbound]) expect(s.durationMinutes).toBeGreaterThan(0);
    const nonstop = all.find((o) => o.outbound.stops === 0)!.outbound.durationMinutes!;
    const oneStop = all.find((o) => o.outbound.stops === 1)!.outbound.durationMinutes!;
    expect(oneStop).toBeGreaterThan(nonstop);
  });

  it("returns nothing when the member already lives at the destination", () => {
    expect(sampleFlightOffers({ ...q, origin: "BNA" })).toEqual([]);
  });
});

describe("FR-303 booking links", () => {
  const routes: FlightQuery[] = [
    q,
    { origin: "ORD", destination: "MIA", departDate: "2027-03-12", returnDate: "2027-03-17" },
    { origin: "ATL", destination: "DEN", departDate: "2027-07-01", returnDate: "2027-07-05" },
    { origin: "SEA", destination: "JFK", departDate: "2027-09-10", returnDate: "2027-09-14" },
  ];

  it("20 offers each link to Google Flights for that exact route and dates", () => {
    const offers = routes.flatMap((r) => selectFlightOffers(sampleFlightOffers(r), r, Number.MAX_SAFE_INTEGER).slice(0, 5).map((o) => ({ r, o })));
    expect(offers).toHaveLength(20);
    for (const { r, o } of offers) {
      const url = new URL(o.bookingUrl);
      expect(url.origin + url.pathname).toBe("https://www.google.com/travel/flights");
      // The exact wording verified by hand to fill in both airports and dates.
      expect(url.searchParams.get("q")).toBe(`Flights to ${r.destination} from ${r.origin} on ${r.departDate} through ${r.returnDate}`);
      expect(url.searchParams.get("curr")).toBe("USD");
      // No airline name: it made Google ignore the whole query.
      expect(o.bookingUrl).not.toContain(encodeURIComponent(o.airline.name));
      expect(o.bookingUrl).toBe(googleFlightsUrl(r));
    }
  });

  it("matches the link checked by hand for IND -> BNA, May 21-25 2027", () => {
    expect(googleFlightsUrl(q)).toBe(
      "https://www.google.com/travel/flights?q=Flights%20to%20BNA%20from%20IND%20on%202027-05-21%20through%202027-05-25&curr=USD",
    );
  });
});
