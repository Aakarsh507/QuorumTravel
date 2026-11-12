import { z } from "zod";
import { findAirport, isKnownAirport, milesBetween } from "./airports";

/* ------------------------------------------------------------------ *
 * SYS-01 — member travel preferences (FR-101, FR-102)
 * ------------------------------------------------------------------ */

/** Fixed tag list from the SDP (FR-101 supporting context). */
export const PREFERENCE_TAGS = ["beach", "city", "outdoors", "nightlife", "food", "culture"] as const;
export type PreferenceTag = (typeof PREFERENCE_TAGS)[number];

const ymd = z
  .string()
  .min(1, "Pick a date")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");

export const dateRangeSchema = z
  .object({ start: ymd, end: ymd })
  .refine((r) => r.end >= r.start, { message: "End date must be on or after the start date", path: ["end"] });

export const preferenceInputSchema = z.object({
  dateRanges: z.array(dateRangeSchema).min(1, "Add at least one date range").max(5, "At most 5 date ranges"),
  maxBudgetUsd: z
    .number({ invalid_type_error: "Enter a budget in USD" })
    .int("Whole dollars only")
    .positive("Budget must be more than $0")
    .max(100_000, "Budget looks too large"),
  departureAirport: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Enter your departure airport")
    .refine(isKnownAirport, "Unknown airport code (use a 3-letter IATA code such as IND)"),
  tags: z.array(z.enum(PREFERENCE_TAGS)).max(5, "Pick up to 5 tags").default([]),
});

export type PreferenceInput = z.input<typeof preferenceInputSchema>;
export type Preference = z.output<typeof preferenceInputSchema>;

/* ------------------------------------------------------------------ *
 * SYS-02 — group plan solver (FR-201, FR-202)
 *
 * Hard constraints: everyone is free on the dates, and the estimated cost
 * is within every member's budget. Soft: preference tags, scored.
 * The result never contains any member's raw dates or budget (FR-103).
 * ------------------------------------------------------------------ */

export interface Destination {
  airport: string;
  city: string;
  state: string;
  tags: PreferenceTag[];
  /** Estimated lodging cost per person per night (shared rental), USD. */
  lodgingPerNight: number;
}

export const DESTINATIONS: readonly Destination[] = [
  { airport: "MIA", city: "Miami", state: "Florida", tags: ["beach", "nightlife", "food", "city", "culture"], lodgingPerNight: 95 },
  { airport: "BNA", city: "Nashville", state: "Tennessee", tags: ["nightlife", "food", "culture", "city"], lodgingPerNight: 80 },
  { airport: "AVL", city: "Asheville", state: "North Carolina", tags: ["outdoors", "food", "culture"], lodgingPerNight: 65 },
  { airport: "MSY", city: "New Orleans", state: "Louisiana", tags: ["food", "nightlife", "culture", "city"], lodgingPerNight: 80 },
  { airport: "DEN", city: "Denver", state: "Colorado", tags: ["outdoors", "city", "food"], lodgingPerNight: 75 },
  { airport: "SAN", city: "San Diego", state: "California", tags: ["beach", "outdoors", "food", "city"], lodgingPerNight: 105 },
  { airport: "JFK", city: "New York", state: "New York", tags: ["city", "food", "culture", "nightlife"], lodgingPerNight: 140 },
  { airport: "AUS", city: "Austin", state: "Texas", tags: ["nightlife", "food", "outdoors", "city"], lodgingPerNight: 80 },
  { airport: "LAS", city: "Las Vegas", state: "Nevada", tags: ["nightlife", "city", "food"], lodgingPerNight: 70 },
  { airport: "MCO", city: "Orlando", state: "Florida", tags: ["beach", "outdoors"], lodgingPerNight: 65 },
  { airport: "CHS", city: "Charleston", state: "South Carolina", tags: ["beach", "food", "culture"], lodgingPerNight: 90 },
  { airport: "SEA", city: "Seattle", state: "Washington", tags: ["outdoors", "city", "food", "culture"], lodgingPerNight: 100 },
];

/** Food + activities per person per day, USD. */
export const DAILY_SPEND = 60;
export const MAX_NIGHTS = 5;

export interface PlanInputMember extends Preference {
  /** Opaque id used only to count members; never copied into the result. */
  memberId: string;
}

export interface PlanAlternative {
  city: string;
  state: string;
  matchScore: number;
}

export interface FeasiblePlan {
  feasible: true;
  destination: { airport: string; city: string; state: string };
  startDate: string; // YYYY-MM-DD
  endDate: string;
  nights: number;
  /** Highest estimated cost for any member: the per-person budget cap. */
  perPersonCapUsd: number;
  /** Lowest estimated cost for any member (members fly from different airports). */
  perPersonLowUsd: number;
  withinAllBudgets: true;
  sharedInterests: PreferenceTag[];
  matchScore: number; // 0–100
  alternatives: PlanAlternative[];
  memberCount: number;
}

export interface InfeasiblePlan {
  feasible: false;
  conflict: "dates" | "budget";
  message: string;
  suggestion: string;
  memberCount: number;
}

export type PlanResult = FeasiblePlan | InfeasiblePlan;

const DAY_MS = 86_400_000;
const toDay = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY_MS);
const fromDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
const prettyDay = (d: number) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d * DAY_MS));

function availableDays(m: Preference): Set<number> {
  const days = new Set<number>();
  for (const r of m.dateRanges) for (let d = toDay(r.start); d <= toDay(r.end); d++) days.add(d);
  return days;
}

/** Longest run of consecutive days in which at least `need` members are free. */
function longestRun(counts: Map<number, number>, need: number): { start: number; length: number } | null {
  const days = [...counts.entries()].filter(([, c]) => c >= need).map(([d]) => d).sort((a, b) => a - b);
  let best: { start: number; length: number } | null = null;
  let runStart = days[0];
  for (let i = 0; i < days.length; i++) {
    if (i > 0 && days[i] !== days[i - 1]! + 1) runStart = days[i];
    const length = days[i]! - runStart! + 1;
    if (!best || length > best.length) best = { start: runStart!, length };
  }
  return best;
}

/** Round-trip airfare estimate from distance (prototype stand-in for SYS-03 search). */
export function estimateAirfare(from: string, to: string): number {
  if (from === to) return 0;
  const a = findAirport(from);
  const b = findAirport(to);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.round(90 + 0.15 * milesBetween(a, b));
}

export function estimateCost(member: Preference, dest: Destination, nights: number): number {
  return estimateAirfare(member.departureAirport, dest.airport) + nights * dest.lodgingPerNight + (nights + 1) * DAILY_SPEND;
}

function interestScore(members: Preference[], dest: Destination): number {
  const per = members.map((m) =>
    m.tags.length === 0 ? 0.5 : m.tags.filter((t) => dest.tags.includes(t)).length / m.tags.length,
  );
  return per.reduce((a, b) => a + b, 0) / members.length;
}

function sharedInterests(members: Preference[], dest: Destination): PreferenceTag[] {
  const need = members.length === 1 ? 1 : 2;
  return dest.tags.filter((t) => members.filter((m) => m.tags.includes(t)).length >= need);
}

/**
 * FR-201 / FR-202: pick dates, a destination and a per-person cap that satisfy
 * every member's hard constraints, or explain which constraint type conflicts.
 */
export function solveGroupPlan(members: PlanInputMember[], destinations: readonly Destination[] = DESTINATIONS): PlanResult {
  const n = members.length;
  if (n === 0) throw new Error("solveGroupPlan needs at least one member");

  // ---- dates (hard)
  const counts = new Map<number, number>();
  for (const m of members) for (const d of availableDays(m)) counts.set(d, (counts.get(d) ?? 0) + 1);
  const window = longestRun(counts, n);

  if (!window || window.length < 2) {
    // best partial window: most members, then longest
    let suggestion = "Ask everyone to add another available date range.";
    for (let need = n - 1; need >= 2; need--) {
      const w = longestRun(counts, need);
      if (w && w.length >= 2) {
        suggestion = `${prettyDay(w.start)} – ${prettyDay(w.start + w.length - 1)} works for ${need} of ${n} travelers. Ask the others whether they can shift their dates.`;
        break;
      }
    }
    return {
      feasible: false,
      conflict: "dates",
      message: "There are no dates when everyone in the group is free for at least one night.",
      suggestion,
      memberCount: n,
    };
  }

  // ---- budget (hard): longest stay that still fits everyone, up to MAX_NIGHTS
  const maxNights = Math.min(window.length - 1, MAX_NIGHTS);
  for (let nights = maxNights; nights >= 1; nights--) {
    const scored = destinations
      .map((dest) => {
        const costs = members.map((m) => estimateCost(m, dest, nights));
        const fits = members.every((m, i) => costs[i]! <= m.maxBudgetUsd);
        const slack = members.reduce((s, m, i) => s + (m.maxBudgetUsd - costs[i]!) / m.maxBudgetUsd, 0) / n;
        const score = 0.8 * interestScore(members, dest) + 0.2 * Math.max(0, slack);
        return { dest, costs, fits, score: Math.round(score * 100) };
      })
      .filter((x) => x.fits)
      .sort((a, b) => b.score - a.score || a.dest.city.localeCompare(b.dest.city));

    const best = scored[0];
    if (!best) continue;
    return {
      feasible: true,
      destination: { airport: best.dest.airport, city: best.dest.city, state: best.dest.state },
      startDate: fromDay(window.start),
      endDate: fromDay(window.start + nights),
      nights,
      perPersonCapUsd: Math.max(...best.costs),
      perPersonLowUsd: Math.min(...best.costs),
      withinAllBudgets: true,
      sharedInterests: sharedInterests(members, best.dest),
      matchScore: best.score,
      alternatives: scored.slice(1, 4).map((x) => ({ city: x.dest.city, state: x.dest.state, matchScore: x.score })),
      memberCount: n,
    };
  }

  // nothing fits even for one night: say how many are over, never by how much
  const cheapest = destinations
    .map((dest) => ({ dest, over: members.filter((m) => estimateCost(m, dest, 1) > m.maxBudgetUsd).length }))
    .sort((a, b) => a.over - b.over)[0]!;
  return {
    feasible: false,
    conflict: "budget",
    message: "No destination fits everyone's budget, even for a one-night trip.",
    suggestion: `The closest option, ${cheapest.dest.city}, is over budget for ${cheapest.over} of ${n} travelers. They could raise their budget or choose a closer departure airport.`,
    memberCount: n,
  };
}

/* ------------------------------------------------------------------ *
 * SYS-02 — voting (FR-203). Majority = more than half of members.
 * ------------------------------------------------------------------ */

export type VoteChoice = "APPROVE" | "REJECT";
export type PlanStatus = "PROPOSED" | "CONFIRMED" | "REJECTED" | "INFEASIBLE";

export function tallyStatus(approvals: number, rejections: number, memberCount: number): "PROPOSED" | "CONFIRMED" | "REJECTED" {
  if (approvals * 2 > memberCount) return "CONFIRMED";
  if (rejections * 2 > memberCount) return "REJECTED";
  return "PROPOSED";
}

export const voteInputSchema = z.object({ choice: z.enum(["APPROVE", "REJECT"]) });
