import { describe, expect, it } from "vitest";
import {
  AIRPORTS,
  DESTINATIONS,
  PREFERENCE_TAGS,
  estimateCost,
  preferenceInputSchema,
  solveGroupPlan,
  tallyStatus,
  type PlanInputMember,
} from "./index";

/** Small deterministic RNG so the synthetic groups are the same every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

const valid = {
  dateRanges: [{ start: "2027-03-12", end: "2027-03-20" }],
  maxBudgetUsd: 1500,
  departureAirport: "ind",
  tags: ["nightlife", "food"],
};

describe("FR-101 preference capture", () => {
  it("accepts a complete form and normalises the airport code", () => {
    const p = preferenceInputSchema.parse(valid);
    expect(p).toEqual({ ...valid, departureAirport: "IND" });
  });
  it("accepts several date ranges and no tags", () => {
    const p = preferenceInputSchema.parse({ ...valid, tags: undefined, dateRanges: [valid.dateRanges[0], { start: "2027-04-01", end: "2027-04-03" }] });
    expect(p.dateRanges).toHaveLength(2);
    expect(p.tags).toEqual([]);
  });
});

describe("FR-102 preference validation (15 invalid inputs, 5 per error type)", () => {
  const badDates = [
    { start: "2027-03-20", end: "2027-03-12" },
    { start: "2027-01-02", end: "2027-01-01" },
    { start: "2027-12-31", end: "2027-01-01" },
    { start: "2028-06-10", end: "2028-06-09" },
    { start: "2027-05-05", end: "2026-05-05" },
  ];
  const badBudgets = [0, -1, -500, 0.5, Number.NaN];
  const badAirports = ["XXX", "ZZZ", "QQQ", "IN", "INDY"];

  it.each(badDates)("rejects end before start %o", (r) => {
    const res = preferenceInputSchema.safeParse({ ...valid, dateRanges: [r] });
    expect(res.success).toBe(false);
    expect(res.error!.issues[0]!.path).toEqual(["dateRanges", 0, "end"]);
  });
  it.each(badBudgets)("rejects budget %s", (b) => {
    const res = preferenceInputSchema.safeParse({ ...valid, maxBudgetUsd: b });
    expect(res.success).toBe(false);
    expect(res.error!.issues[0]!.path).toEqual(["maxBudgetUsd"]);
  });
  it.each(badAirports)("rejects unknown airport %s", (a) => {
    const res = preferenceInputSchema.safeParse({ ...valid, departureAirport: a });
    expect(res.success).toBe(false);
    expect(res.error!.issues[0]!.message).toMatch(/Unknown airport/);
  });
});

function feasibleGroup(r: () => number, size: number): PlanInputMember[] {
  // everyone is free 2027-03-10..15 plus some private extra days
  return Array.from({ length: size }, (_, i) => ({
    memberId: `m${i}`,
    dateRanges: [{ start: `2027-03-${String(5 + Math.floor(r() * 5)).padStart(2, "0")}`, end: `2027-03-${15 + Math.floor(r() * 5)}` }],
    maxBudgetUsd: 1800 + Math.floor(r() * 2000),
    departureAirport: pick(r, AIRPORTS).code,
    tags: PREFERENCE_TAGS.filter(() => r() < 0.4),
  }));
}

describe("FR-201 plan generation satisfies every hard constraint", () => {
  const r = rng(201);
  for (let g = 0; g < 20; g++) {
    const group = feasibleGroup(r, 2 + (g % 9));
    it(`synthetic group ${g + 1} (${group.length} members)`, () => {
      const plan = solveGroupPlan(group);
      expect(plan.feasible).toBe(true);
      if (!plan.feasible) return;
      const dest = DESTINATIONS.find((d) => d.airport === plan.destination.airport)!;
      for (const m of group) {
        // dates: every trip day is inside one of the member's ranges
        expect(m.dateRanges.some((x) => x.start <= plan.startDate && plan.endDate <= x.end)).toBe(true);
        // budget: estimated cost within this member's cap, and under the plan's cap
        const cost = estimateCost(m, dest, plan.nights);
        expect(cost).toBeLessThanOrEqual(m.maxBudgetUsd);
        expect(cost).toBeLessThanOrEqual(plan.perPersonCapUsd);
      }
    });
  }

  it("prefers the destination matching shared tags", () => {
    const group: PlanInputMember[] = ["a", "b", "c"].map((id) => ({
      memberId: id,
      dateRanges: [{ start: "2027-03-12", end: "2027-03-20" }],
      maxBudgetUsd: 3000,
      departureAirport: "IND",
      tags: ["beach", "nightlife", "food"],
    }));
    const plan = solveGroupPlan(group);
    expect(plan.feasible && plan.destination.city).toBe("Miami");
    expect(plan.feasible && plan.sharedInterests).toEqual(["beach", "nightlife", "food"]);
  });

  it("shortens the trip rather than break a budget", () => {
    const tight: PlanInputMember[] = [
      { memberId: "a", dateRanges: [{ start: "2027-03-01", end: "2027-03-30" }], maxBudgetUsd: 450, departureAirport: "IND", tags: [] },
      { memberId: "b", dateRanges: [{ start: "2027-03-01", end: "2027-03-30" }], maxBudgetUsd: 5000, departureAirport: "IND", tags: [] },
    ];
    const plan = solveGroupPlan(tight);
    expect(plan.feasible).toBe(true);
    if (plan.feasible) expect(plan.nights).toBeLessThan(5);
  });
});

describe("FR-202 infeasibility report names the conflict without private values", () => {
  const r = rng(202);
  const cases: { kind: "dates" | "budget"; group: PlanInputMember[] }[] = [];
  for (let i = 0; i < 5; i++) {
    const g = feasibleGroup(r, 3 + i);
    g[0] = { ...g[0]!, dateRanges: [{ start: "2027-07-01", end: "2027-07-04" }] }; // nobody else free in July
    cases.push({ kind: "dates", group: g });
  }
  for (let i = 0; i < 5; i++) {
    const g = feasibleGroup(r, 3 + i);
    g[1] = { ...g[1]!, maxBudgetUsd: 50 + i * 20 }; // below the cheapest possible 1-night trip ($185)
    cases.push({ kind: "budget", group: g });
  }

  it.each(cases.map((c, i) => [i + 1, c] as const))("infeasible group %i", (_, { kind, group }) => {
    const plan = solveGroupPlan(group);
    expect(plan.feasible).toBe(false);
    if (plan.feasible) return;
    expect(plan.conflict).toBe(kind);
    expect(plan.suggestion.length).toBeGreaterThan(10);
    const text = JSON.stringify(plan);
    for (const m of group) {
      expect(text).not.toContain(String(m.maxBudgetUsd));
      expect(text).not.toContain(m.departureAirport);
      for (const d of m.dateRanges) {
        expect(text).not.toContain(d.start);
        expect(text).not.toContain(d.end);
      }
    }
  });

  it("the suggested date window really is shared by the stated number of travelers", () => {
    const group: PlanInputMember[] = [
      { memberId: "a", dateRanges: [{ start: "2027-03-12", end: "2027-03-16" }], maxBudgetUsd: 3000, departureAirport: "IND", tags: [] },
      { memberId: "b", dateRanges: [{ start: "2027-03-13", end: "2027-03-18" }], maxBudgetUsd: 3000, departureAirport: "IND", tags: [] },
      { memberId: "c", dateRanges: [{ start: "2027-05-01", end: "2027-05-03" }], maxBudgetUsd: 3000, departureAirport: "IND", tags: [] },
    ];
    const plan = solveGroupPlan(group);
    expect(plan.feasible).toBe(false);
    if (!plan.feasible) expect(plan.suggestion).toBe("Mar 13 – Mar 16 works for 2 of 3 travelers. Ask the others whether they can shift their dates.");
  });
});

describe("FR-203 majority voting", () => {
  it("four-person group: three approvals confirm, two do not", () => {
    expect(tallyStatus(3, 0, 4)).toBe("CONFIRMED");
    expect(tallyStatus(2, 0, 4)).toBe("PROPOSED");
    expect(tallyStatus(2, 2, 4)).toBe("PROPOSED");
  });
  it.each([
    [3, 2, 1],
    [5, 3, 2],
    [6, 4, 3],
  ])("group of %i: %i approvals confirm, %i do not", (size, yes, notEnough) => {
    expect(tallyStatus(yes, 0, size)).toBe("CONFIRMED");
    expect(tallyStatus(notEnough, 0, size)).toBe("PROPOSED");
  });
  it("a rejecting majority rejects the plan", () => {
    expect(tallyStatus(1, 3, 5)).toBe("REJECTED");
  });
});

describe("NFR-201 solver time", () => {
  it("50 synthetic groups of 2–10 members, p95 under 10 s", () => {
    const r = rng(2010);
    const times: number[] = [];
    for (let g = 0; g < 50; g++) {
      const group = feasibleGroup(r, 2 + (g % 9));
      const t = performance.now();
      solveGroupPlan(group);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(10_000);
  });
});
