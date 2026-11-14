import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { seed, seedPlanning } from "../prisma/seed";

const prisma = new PrismaClient();
let server: Awaited<ReturnType<typeof createApp>>;
let baseUrl: string;
let t: Awaited<ReturnType<typeof seedPlanning>>["trips"];
let u: Awaited<ReturnType<typeof seedPlanning>>["users"];
let outsider: string;

beforeAll(async () => {
  server = await createApp({ prisma });
  await server.app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${(server.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await seed(prisma);
  ({ trips: t, users: u } = await seedPlanning(prisma));
  outsider = (await prisma.user.create({ data: { displayName: "Outsider" } })).id;
});

async function api(method: string, path: string, user: string | null, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(user ? { "x-user-id": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, text };
}

const alexPrefs = {
  dateRanges: [{ start: "2027-03-12", end: "2027-03-20" }],
  maxBudgetUsd: 1500,
  departureAirport: "IND",
  tags: ["nightlife", "food"],
};

describe("trip setup (Workflow 1, screens 1–2)", () => {
  it("lists Alex's trips with their status labels", async () => {
    const r = await api("GET", "/me/trips", u.alex);
    expect(r.status).toBe(200);
    expect(r.json.map((x: { name: string; status: { label: string } }) => [x.name, x.status.label])).toEqual([
      ["Miami Spring Break 2027", "Collecting preferences (2 of 5)"],
      ["Nashville Reunion", "Confirmed"],
      ["Asheville Weekend", "Dates conflict"],
    ]);
  });

  it("creates a trip, invites by email, and a second user joins through the link", async () => {
    const created = await api("POST", "/trips", u.sam, { name: "Denver Ski Trip" });
    expect(created.status).toBe(201);
    const id = created.json.id;

    const inv = await api("POST", `/trips/${id}/invites`, u.sam, { emails: ["Friend@Example.com", "friend@example.com"] });
    expect(inv.status).toBe(201);
    expect(inv.json).toEqual([{ email: "friend@example.com", status: "INVITED" }]);

    expect((await api("GET", `/trips/${id}`, u.priya)).status).toBe(403);
    expect((await api("POST", `/join/${created.json.inviteCode}`, u.priya)).status).toBe(200);
    const trip = await api("GET", `/trips/${id}`, u.priya);
    expect(trip.json.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual(["Priya Nair", "Sam Patel"]);
    expect(trip.json.me.role).toBe("MEMBER");
  });

  it("rejects bad input and non-creators", async () => {
    expect((await api("POST", "/trips", u.alex, { name: "  " })).status).toBe(400);
    expect((await api("POST", `/trips/${t.miami}/invites`, u.alex, { emails: ["not-an-email"] })).status).toBe(400);
    expect((await api("POST", `/trips/${t.miami}/invites`, u.maya, { emails: ["a@b.co"] })).status).toBe(403);
    expect((await api("POST", "/join/nope", u.alex)).status).toBe(404);
    expect((await api("GET", "/me/trips", null)).status).toBe(401);
  });
});

describe("deleting a trip", () => {
  it("only the creator can delete; everything in the trip goes with it", async () => {
    expect((await api("DELETE", `/trips/${t.nash}`, u.maya)).status).toBe(403);
    expect((await api("DELETE", `/trips/${t.nash}`, outsider)).status).toBe(403);
    expect((await api("DELETE", `/trips/${t.nash}`, null)).status).toBe(401);

    expect((await api("DELETE", `/trips/${t.nash}`, u.alex)).status).toBe(204);
    expect(await prisma.trip.count({ where: { id: t.nash } })).toBe(0);
    expect(await prisma.tripMember.count({ where: { tripId: t.nash } })).toBe(0);
    expect(await prisma.preference.count({ where: { tripId: t.nash } })).toBe(0);
    expect(await prisma.groupPlan.count({ where: { tripId: t.nash } })).toBe(0);
    expect(await prisma.vote.count()).toBe(0); // Nashville held the only votes

    // gone from every member's dashboard, other trips untouched
    const maya = await api("GET", "/me/trips", u.maya);
    expect(maya.json.map((x: { name: string }) => x.name)).toEqual(["Miami Spring Break 2027"]);
    expect((await api("GET", `/trips/${t.nash}`, u.alex)).status).toBe(403);
    expect((await api("DELETE", `/trips/${t.nash}`, u.alex)).status).toBe(403);
  });
});

describe("FR-101 constraint submission (5 users)", () => {
  it("stores every field exactly for 5 of 5 users", async () => {
    const people = [u.alex, u.maya, u.jordan, u.sam, u.priya];
    for (const [i, who] of people.entries()) {
      const p = { ...alexPrefs, maxBudgetUsd: 1000 + i * 100, tags: [["beach"], ["city", "food"], [], ["outdoors"], ["culture", "food", "nightlife"]][i] };
      expect((await api("PUT", `/trips/${t.miami}/preferences/me`, who, p)).status).toBe(200);
      const back = await api("GET", `/trips/${t.miami}/preferences/me`, who);
      expect(back.json.preference).toEqual(p);
    }
  });
});

describe("FR-102 constraint validation", () => {
  it.each([
    ["dateRanges.0.end", { dateRanges: [{ start: "2027-03-20", end: "2027-03-12" }] }],
    ["maxBudgetUsd", { maxBudgetUsd: 0 }],
    ["departureAirport", { departureAirport: "XYZ" }],
  ])("returns a field-level error for %s and stores nothing", async (field, bad) => {
    const r = await api("PUT", `/trips/${t.miami}/preferences/me`, u.sam, { ...alexPrefs, ...bad });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json.fields)).toEqual([field]);
    expect(await prisma.preference.count({ where: { tripId: t.miami, userId: u.sam } })).toBe(0);
  });
});

describe("FR-103 constraint privacy", () => {
  it("20 attempts to read another member's constraints are all denied", async () => {
    const attempts = [
      ...[u.maya, u.jordan].flatMap((target) => [
        api("GET", `/trips/${t.miami}/preferences/${target}`, u.alex),
        api("GET", `/trips/${t.miami}/preferences?userId=${target}`, u.alex),
        api("GET", `/trips/${t.miami}/preferences`, u.sam),
        api("GET", `/trips/${t.miami}/members/${target}/preferences`, u.alex),
      ]),
      ...Array.from({ length: 6 }, () => api("GET", `/trips/${t.miami}/preferences/me`, outsider)),
      ...Array.from({ length: 6 }, () => api("GET", `/trips/${t.miami}/readiness`, outsider)),
    ];
    const results = await Promise.all(attempts);
    expect(results).toHaveLength(20);
    for (const r of results) expect([403, 404]).toContain(r.status);
  });

  it("readiness, trip and plan responses never contain other members' values", async () => {
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    const bodies = await Promise.all([
      api("GET", `/trips/${t.miami}/readiness`, u.sam),
      api("GET", `/trips/${t.miami}`, u.sam),
      api("GET", `/trips/${t.miami}/plan`, u.sam),
      api("GET", "/me/trips", u.sam),
    ]);
    for (const b of bodies) {
      expect(b.status).toBe(200);
      for (const secret of ["1600", "1400", "1500", "2027-03-10", "2027-03-19", "ORD", "maxBudgetUsd", "dateRanges"])
        expect(b.text).not.toContain(secret);
    }
  });
});

describe("FR-201 / FR-202 generating the group plan (screens 4–5)", () => {
  it("shows readiness, then Alex generates a Miami plan within all budgets", async () => {
    let ready = await api("GET", `/trips/${t.miami}/readiness`, u.alex);
    expect(ready.json).toMatchObject({ readyCount: 2, memberCount: 5, canGenerate: true });

    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    ready = await api("GET", `/trips/${t.miami}/readiness`, u.alex);
    expect(ready.json.readyCount).toBe(3);
    expect(ready.json.members.filter((m: { submitted: boolean }) => m.submitted).map((m: { displayName: string }) => m.displayName)).toEqual([
      "Alex Rivera",
      "Jordan Lee",
      "Maya Chen",
    ]);

    const gen = await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    expect(gen.status).toBe(201);
    expect(gen.json.plan.status).toBe("PROPOSED");
    expect(gen.json.plan.result).toMatchObject({ feasible: true, withinAllBudgets: true, destination: { city: "Miami" } });
    expect(gen.json.plan.result.perPersonCapUsd).toBeLessThanOrEqual(1400);
  });

  it("only the creator can generate, and needs two submissions", async () => {
    expect((await api("POST", `/trips/${t.miami}/plan/generate`, u.maya)).status).toBe(403);
    await prisma.preference.deleteMany({ where: { tripId: t.miami, userId: u.jordan } });
    expect((await api("GET", `/trips/${t.miami}/readiness`, u.alex)).json.canGenerate).toBe(false);
    expect((await api("POST", `/trips/${t.miami}/plan/generate`, u.alex)).status).toBe(409);
  });

  it("an infeasible group gets a conflict report instead of a plan", async () => {
    const r = await api("GET", `/trips/${t.ash}/plan`, u.jordan);
    expect(r.json.plan.status).toBe("INFEASIBLE");
    expect(r.json.plan.result).toMatchObject({ feasible: false, conflict: "dates" });
    expect(r.json.plan.result.suggestion).toMatch(/works for 2 of 3 travelers/);
  });
});

describe("FR-203 plan voting (screens 5–6)", () => {
  it("five-person group: 2 approvals stay proposed, the 3rd confirms, then voting closes", async () => {
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);

    let r = await api("POST", `/trips/${t.miami}/plan/vote`, u.alex, { choice: "APPROVE" });
    r = await api("POST", `/trips/${t.miami}/plan/vote`, u.maya, { choice: "APPROVE" });
    expect(r.json.plan).toMatchObject({ status: "PROPOSED", approvals: 2, memberCount: 5, needed: 3, myVote: "APPROVE" });

    r = await api("POST", `/trips/${t.miami}/plan/vote`, u.sam, { choice: "REJECT" });
    expect(r.json.plan).toMatchObject({ status: "PROPOSED", rejections: 1 });

    r = await api("POST", `/trips/${t.miami}/plan/vote`, u.jordan, { choice: "APPROVE" });
    expect(r.json.plan).toMatchObject({ status: "CONFIRMED", approvals: 3 });

    expect((await api("POST", `/trips/${t.miami}/plan/vote`, u.priya, { choice: "APPROVE" })).status).toBe(409);
    const trips = await api("GET", "/me/trips", u.alex);
    expect(trips.json[0].status.label).toBe("Confirmed");
  });

  it("changing a vote replaces it, and a rejecting majority rejects the plan", async () => {
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    await api("POST", `/trips/${t.miami}/plan/vote`, u.maya, { choice: "APPROVE" });
    await api("POST", `/trips/${t.miami}/plan/vote`, u.maya, { choice: "REJECT" });
    await api("POST", `/trips/${t.miami}/plan/vote`, u.sam, { choice: "REJECT" });
    const r = await api("POST", `/trips/${t.miami}/plan/vote`, u.priya, { choice: "REJECT" });
    expect(r.json.plan).toMatchObject({ status: "REJECTED", approvals: 0, rejections: 3 });
  });

  it("rejects bad votes and outsiders", async () => {
    expect((await api("POST", `/trips/${t.miami}/plan/vote`, u.maya, { choice: "APPROVE" })).status).toBe(404);
    expect((await api("POST", `/trips/${t.nash}/plan/vote`, u.maya, { choice: "MAYBE" })).status).toBe(400);
    expect((await api("POST", `/trips/${t.nash}/plan/vote`, outsider, { choice: "APPROVE" })).status).toBe(403);
  });
});

describe("FR-204 re-solve on change", () => {
  async function proposeMiami() {
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    const gen = await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    expect(gen.json.plan).toMatchObject({ status: "PROPOSED", outdated: false, outdatedAt: null });
  }

  it("a member changing preferences marks the plan outdated for everyone, without saying who", async () => {
    await proposeMiami();
    const mayaPrefs = { ...alexPrefs, departureAirport: "ORD", maxBudgetUsd: 1777 };
    expect((await api("PUT", `/trips/${t.miami}/preferences/me`, u.maya, mayaPrefs)).status).toBe(200);

    for (const viewer of [u.alex, u.jordan, u.priya]) {
      const r = await api("GET", `/trips/${t.miami}/plan`, viewer);
      expect(r.json.plan).toMatchObject({ status: "PROPOSED", outdated: true });
      expect(typeof r.json.plan.outdatedAt).toBe("string");
      expect(r.text).not.toContain(u.maya);
      expect(r.text).not.toContain("1777");
    }
    const trips = await api("GET", "/me/trips", u.jordan);
    expect(trips.json.find((x: { id: string }) => x.id === t.miami).status).toEqual({ label: "Plan outdated", tone: "warn" });
  });

  it("re-saving identical preferences does not mark the plan outdated", async () => {
    await proposeMiami();
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, { ...alexPrefs, tags: ["food", "nightlife"] });
    expect((await api("GET", `/trips/${t.miami}/plan`, u.alex)).json.plan.outdated).toBe(false);
  });

  it("a first submission after the plan was generated also marks it outdated", async () => {
    await proposeMiami();
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.sam, alexPrefs);
    expect((await api("GET", `/trips/${t.miami}/plan`, u.alex)).json.plan.outdated).toBe(true);
  });

  it("voting is paused on an outdated plan and existing votes are kept", async () => {
    await proposeMiami();
    await api("POST", `/trips/${t.miami}/plan/vote`, u.jordan, { choice: "APPROVE" });
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.maya, { ...alexPrefs, maxBudgetUsd: 1600 });
    const v = await api("POST", `/trips/${t.miami}/plan/vote`, u.priya, { choice: "APPROVE" });
    expect(v.status).toBe(409);
    expect(v.json.error).toMatch(/regenerate/);
    expect((await api("GET", `/trips/${t.miami}/plan`, u.alex)).json.plan).toMatchObject({ approvals: 1, outdated: true });
  });

  it("only the organizer can regenerate; the new plan is current and votes start over", async () => {
    await proposeMiami();
    await api("POST", `/trips/${t.miami}/plan/vote`, u.jordan, { choice: "APPROVE" });
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.maya, { ...alexPrefs, maxBudgetUsd: 1600 });

    expect((await api("POST", `/trips/${t.miami}/plan/generate`, u.maya)).status).toBe(403);
    const gen = await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    expect(gen.status).toBe(201);
    expect(gen.json.plan).toMatchObject({ status: "PROPOSED", outdated: false, approvals: 0, myVote: null });
    expect((await api("POST", `/trips/${t.miami}/plan/vote`, u.priya, { choice: "APPROVE" })).status).toBe(200);
  });

  it("a confirmed plan is flagged outdated but stays confirmed until regenerated", async () => {
    await api("PUT", `/trips/${t.nash}/preferences/me`, u.sam, { ...alexPrefs, maxBudgetUsd: 2500 });
    const r = await api("GET", `/trips/${t.nash}/plan`, u.maya);
    expect(r.json.plan).toMatchObject({ status: "CONFIRMED", outdated: true });
  });

  it("an infeasible plan is flagged outdated so the organizer knows to try again", async () => {
    await api("PUT", `/trips/${t.ash}/preferences/me`, u.priya, { ...alexPrefs, maxBudgetUsd: 2000 });
    const r = await api("GET", `/trips/${t.ash}/plan`, u.alex);
    expect(r.json.plan).toMatchObject({ status: "INFEASIBLE", outdated: true });
  });
});
