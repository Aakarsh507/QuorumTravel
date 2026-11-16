import { DAILY_SPEND, DESTINATIONS, estimateAirfare } from "./planning";

/* ------------------------------------------------------------------ *
 * SYS-03 — flight search (FR-301, FR-303)
 *
 * Providers (Duffel, or the built-in sample generator) return raw offers.
 * `selectFlightOffers` is the single place that enforces FR-301: right
 * airports, right dates, at or below the member's cap, cheapest 10.
 * ------------------------------------------------------------------ */

export const MAX_FLIGHT_OFFERS = 10;

/** One direction of a round trip. Times are local to the airport, "YYYY-MM-DDTHH:MM:SS". */
export interface FlightSlice {
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  stops: number;
  /** Total travel time including layovers. Times above are local, so this can't be derived from them. */
  durationMinutes: number | null;
}

/** What the server asks a provider for: one adult, round trip, economy. */
export interface FlightQuery {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string;
}

/** An offer as a provider returns it, before FR-301 filtering. */
export interface ProviderFlightOffer {
  id: string;
  airline: { code: string; name: string };
  totalAmount: number;
  currency: string;
  outbound: FlightSlice;
  inbound: FlightSlice;
}

/** An offer shown to the member: in USD, within their cap, with a booking link (FR-303). */
export interface FlightOffer {
  id: string;
  airline: { code: string; name: string };
  priceUsd: number;
  outbound: FlightSlice;
  inbound: FlightSlice;
  bookingUrl: string;
}

export interface FlightSearchResult extends FlightQuery {
  /** The caller's own flight cap. Private: only ever returned to that member. */
  capUsd: number;
  source: "duffel" | "sample";
  /** True for sample data and Duffel test mode: prices and schedules are not real. */
  simulated: boolean;
  offers: FlightOffer[];
}

/**
 * Flight cap = the member's trip budget minus the solver's estimate for the
 * rest of the trip (lodging + daily spend). A flight under this cap keeps the
 * member inside the budget the solver promised.
 */
export function flightBudgetCap(
  maxBudgetUsd: number,
  plan: { destination: { airport: string }; nights: number },
): number {
  const lodging = DESTINATIONS.find((d) => d.airport === plan.destination.airport)?.lodgingPerNight ?? 0;
  const rest = plan.nights * lodging + (plan.nights + 1) * DAILY_SPEND;
  return Math.max(0, maxBudgetUsd - rest);
}

/**
 * FR-303: Google Flights search for this exact route and dates. Duffel has no
 * public booking pages, so the member picks the flight and books there.
 *
 * Google has no documented URL format. This wording ("to X from Y ... through")
 * was checked by hand to fill in both airports and both dates. Adding an
 * airline name made Google ignore the whole query, so the airline is left out.
 */
export function googleFlightsUrl(q: FlightQuery): string {
  const text = `Flights to ${q.destination} from ${q.origin} on ${q.departDate} through ${q.returnDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(text)}&curr=USD`;
}

const day = (isoLocal: string) => isoLocal.slice(0, 10);

/** FR-301: keep offers matching the query and the cap, cheapest first, at most 10. */
export function selectFlightOffers(
  offers: readonly ProviderFlightOffer[],
  q: FlightQuery,
  capUsd: number,
): FlightOffer[] {
  return offers
    .filter(
      (o) =>
        o.currency === "USD" &&
        Number.isFinite(o.totalAmount) &&
        o.totalAmount <= capUsd &&
        o.outbound.from === q.origin &&
        o.outbound.to === q.destination &&
        day(o.outbound.departAt) === q.departDate &&
        o.inbound.from === q.destination &&
        o.inbound.to === q.origin &&
        day(o.inbound.departAt) === q.returnDate,
    )
    .sort((a, b) => a.totalAmount - b.totalAmount || a.id.localeCompare(b.id))
    .slice(0, MAX_FLIGHT_OFFERS)
    .map((o) => ({
      id: o.id,
      airline: o.airline,
      priceUsd: o.totalAmount,
      outbound: o.outbound,
      inbound: o.inbound,
      bookingUrl: googleFlightsUrl(q),
    }));
}

/* ---------------------------------------------- sample provider data */

const SAMPLE_AIRLINES = [
  { code: "AA", name: "American Airlines" },
  { code: "DL", name: "Delta Air Lines" },
  { code: "UA", name: "United Airlines" },
  { code: "WN", name: "Southwest Airlines" },
  { code: "B6", name: "JetBlue" },
  { code: "AS", name: "Alaska Airlines" },
  { code: "F9", name: "Frontier Airlines" },
  { code: "NK", name: "Spirit Airlines" },
] as const;

const SAMPLE_COUNT = 14;

function seededRandom(text: string): () => number {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
function localTime(ymd: string, minutes: number): string {
  const t = new Date(Date.parse(`${ymd}T00:00:00Z`) + minutes * 60_000).toISOString();
  return t.slice(0, 19);
}

/**
 * Deterministic stand-in offers when no DUFFEL_TOKEN is set (and in tests).
 * Prices spread around the solver's airfare estimate, so some are over the cap
 * and the FR-301 filter has real work to do.
 */
export function sampleFlightOffers(q: FlightQuery): ProviderFlightOffer[] {
  const base = estimateAirfare(q.origin, q.destination);
  if (!Number.isFinite(base) || base === 0) return [];
  const r = seededRandom(`${q.origin}|${q.destination}|${q.departDate}|${q.returnDate}`);
  const flightMinutes = 45 + Math.round(((base - 90) / 0.15 / 500) * 60);

  const slice = (from: string, to: string, ymd: string, stops: number): FlightSlice => {
    const depart = (6 + Math.floor(r() * 15)) * 60 + 5 * Math.floor(r() * 12);
    const duration = flightMinutes + stops * (60 + Math.floor(r() * 60));
    return {
      from,
      to,
      departAt: localTime(ymd, depart),
      arriveAt: localTime(ymd, depart + duration),
      stops,
      durationMinutes: duration,
    };
  };

  return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
    const airline = SAMPLE_AIRLINES[Math.floor(r() * SAMPLE_AIRLINES.length)]!;
    const stops = r() < 0.55 ? 0 : 1;
    return {
      id: `sample-${q.origin}-${q.destination}-${q.departDate}-${i}`,
      airline: { ...airline },
      totalAmount: Math.round(base * (0.7 + r() * 1.6) - stops * 25),
      currency: "USD",
      outbound: slice(q.origin, q.destination, q.departDate, stops),
      inbound: slice(q.destination, q.origin, q.returnDate, stops),
    };
  });
}
