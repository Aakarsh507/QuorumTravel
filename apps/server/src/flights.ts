import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import {
  flightBudgetCap,
  sampleFlightOffers,
  selectFlightOffers,
  type FlightQuery,
  type FlightSearchResult,
  type FlightSlice,
  type PlanResult,
  type ProviderFlightOffer,
} from "@quorum/shared";
import { USER_HEADER, resolveUser } from "./auth";
import { getMembership } from "./service";

/**
 * SYS-03 flight search (FR-301, FR-303). A provider returns raw offers; the
 * route applies the FR-301 rules with `selectFlightOffers` from the shared
 * package. Each member can only search for themself: the cap is derived from
 * their own private budget and is never returned to anyone else (FR-103).
 */
export interface FlightProvider {
  readonly source: FlightSearchResult["source"];
  /** Prices and schedules are made up (sample data, or a Duffel test token). */
  readonly simulated: boolean;
  search(q: FlightQuery): Promise<ProviderFlightOffer[]>;
}

/** Deterministic offers, no network. Used when DUFFEL_TOKEN is unset, and in tests. */
export class SampleFlightProvider implements FlightProvider {
  readonly source = "sample" as const;
  readonly simulated = true;
  async search(q: FlightQuery) {
    return sampleFlightOffers(q);
  }
}

/* ------------------------------------------------------------- Duffel */

interface DuffelSegment {
  origin: { iata_code: string };
  destination: { iata_code: string };
  departing_at: string;
  arriving_at: string;
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner: { iata_code: string; name: string };
  slices: { duration?: string | null; segments: DuffelSegment[] }[];
}

/** ISO 8601 duration as Duffel sends it ("PT1H7M", "P1DT2H30M") → minutes; null if absent or malformed. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  const m = value ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value) : null;
  if (!m || value === "P" || value === "PT") return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function toSlice(slice: { duration?: string | null; segments: DuffelSegment[] } | undefined): FlightSlice | null {
  const segments = slice?.segments ?? [];
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return null;
  return {
    from: first.origin.iata_code,
    to: last.destination.iata_code,
    departAt: first.departing_at,
    arriveAt: last.arriving_at,
    stops: segments.length - 1,
    durationMinutes: parseIsoDuration(slice?.duration),
  };
}

/** Map a Duffel offer-request response to provider offers. Malformed offers are skipped. */
export function mapDuffelOffers(body: unknown): ProviderFlightOffer[] {
  const offers = (body as { data?: { offers?: DuffelOffer[] } })?.data?.offers ?? [];
  const out: ProviderFlightOffer[] = [];
  for (const o of offers) {
    const outbound = toSlice(o.slices?.[0]);
    const inbound = toSlice(o.slices?.[1]);
    if (!outbound || !inbound || o.slices.length !== 2) continue;
    out.push({
      id: o.id,
      airline: { code: o.owner.iata_code, name: o.owner.name },
      totalAmount: Number(o.total_amount),
      currency: o.total_currency,
      outbound,
      inbound,
    });
  }
  return out;
}

export class DuffelFlightProvider implements FlightProvider {
  readonly source = "duffel" as const;
  /** Duffel test tokens return simulated airlines, schedules and prices. */
  readonly simulated: boolean;
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.simulated = token.startsWith("duffel_test_");
  }

  async search(q: FlightQuery) {
    const res = await this.fetchImpl("https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Duffel-Version": "v2",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        data: {
          slices: [
            { origin: q.origin, destination: q.destination, departure_date: q.departDate },
            { origin: q.destination, destination: q.origin, departure_date: q.returnDate },
          ],
          passengers: [{ type: "adult" }],
          cabin_class: "economy",
          max_connections: 1,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Duffel offer request failed with HTTP ${res.status}`);
    return mapDuffelOffers(await res.json());
  }
}

/** Duffel when a token is configured, otherwise the sample provider. */
export function flightProviderFromEnv(env: NodeJS.ProcessEnv = process.env): FlightProvider {
  const token = env.DUFFEL_TOKEN?.trim();
  return token ? new DuffelFlightProvider(token) : new SampleFlightProvider();
}

/* -------------------------------------------------------------- route */

export function registerFlightRoutes(app: FastifyInstance, prisma: PrismaClient, provider: FlightProvider) {
  // Only "/me": there is deliberately no route to search on another member's behalf.
  app.get("/trips/:tripId/flights/me", async (req: FastifyRequest<{ Params: { tripId: string } }>, reply) => {
    const user = await resolveUser(prisma, req.headers[USER_HEADER] as string | undefined);
    if (!user) return reply.code(401).send({ error: "Not signed in" });
    const { tripId } = req.params;
    if (!(await getMembership(prisma, tripId, user.id)))
      return reply.code(403).send({ error: "You are not a member of this trip" });

    const plan = await prisma.groupPlan.findUnique({ where: { tripId } });
    const result = plan ? (JSON.parse(plan.result) as PlanResult) : null;
    if (plan?.status !== "CONFIRMED" || !result?.feasible)
      return reply.code(409).send({ error: "Flights open once the group plan is confirmed" });

    const pref = await prisma.preference.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
    if (!pref) return reply.code(409).send({ error: "Add your travel preferences first" });

    const query: FlightQuery = {
      origin: pref.departureAirport,
      destination: result.destination.airport,
      departDate: result.startDate,
      returnDate: result.endDate,
    };
    const capUsd = flightBudgetCap(pref.maxBudgetUsd, result);

    let raw: ProviderFlightOffer[] = [];
    if (query.origin !== query.destination) {
      try {
        raw = await provider.search(query);
      } catch (e) {
        console.error(`[flights] ${provider.source} search failed: ${(e as Error).message}`);
        return reply.code(502).send({ error: "Flight search is unavailable right now. Please try again shortly." });
      }
    }
    const body: FlightSearchResult = {
      ...query,
      capUsd,
      source: provider.source,
      simulated: provider.simulated,
      offers: selectFlightOffers(raw, query, capUsd),
    };
    return body;
  });
}
