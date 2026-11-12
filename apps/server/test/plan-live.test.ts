import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { io as connect, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { SOCKET_EVENTS, type PlanChangeReason, type PlanChangedEvent } from "@quorum/shared";
import { createApp } from "../src/app";
import { seed, seedPlanning } from "../prisma/seed";

/**
 * SYS-02 live plan updates: the Group plan screens get `plan:changed` over
 * Socket.IO instead of polling every 3 seconds.
 */

const LIVE_LIMIT_MS = 5000;

const prisma = new PrismaClient();
let server: Awaited<ReturnType<typeof createApp>>;
let baseUrl: string;
let t: Awaited<ReturnType<typeof seedPlanning>>["trips"];
let u: Awaited<ReturnType<typeof seedPlanning>>["users"];
let outsider: string;
const open: Socket[] = [];

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
afterEach(() => {
  while (open.length) open.pop()!.close();
});

async function api(method: string, path: string, user: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Connect as a trip member and wait until the server has put us in the trip's room. */
function member(userId: string, tripId: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(baseUrl, { auth: { userId, tripId }, transports: ["websocket"] });
    open.push(socket);
    // the server sends the itinerary snapshot right after joining the room
    socket.once(SOCKET_EVENTS.snapshot, () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

/** Resolve with the next plan:changed of a given reason, or reject after `ms`. */
function nextPlanChange(socket: Socket, reason: PlanChangeReason, ms = LIVE_LIMIT_MS) {
  return new Promise<PlanChangedEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(SOCKET_EVENTS.planChanged, on);
      reject(new Error(`no plan:changed (${reason}) within ${ms} ms`));
    }, ms);
    function on(e: PlanChangedEvent) {
      if (e.reason !== reason) return;
      clearTimeout(timer);
      socket.off(SOCKET_EVENTS.planChanged, on);
      resolve(e);
    }
    socket.on(SOCKET_EVENTS.planChanged, on);
  });
}

/** Expect that no plan:changed arrives on this socket for `ms`. */
function noPlanChange(socket: Socket, ms = 750) {
  return new Promise<void>((resolve, reject) => {
    const on = (e: PlanChangedEvent) => reject(new Error(`unexpected plan:changed ${JSON.stringify(e)}`));
    socket.on(SOCKET_EVENTS.planChanged, on);
    setTimeout(() => {
      socket.off(SOCKET_EVENTS.planChanged, on);
      resolve();
    }, ms);
  });
}

const alexPrefs = {
  dateRanges: [{ start: "2027-03-12", end: "2027-03-20" }],
  maxBudgetUsd: 1500,
  departureAirport: "IND",
  tags: ["nightlife", "food"],
};

describe("SYS-02 live plan updates (plan:changed)", () => {
  it("one client votes and a second client gets plan:changed within 5 s (10 trials)", async () => {
    // Miami: Maya and Jordan have submitted, Alex (creator) generates the plan
    const jordan = await member(u.jordan, t.miami);
    const generated = nextPlanChange(jordan, "generated");
    expect((await api("POST", `/trips/${t.miami}/plan/generate`, u.alex)).status).toBe(201);
    await generated;

    for (let trial = 0; trial < 10; trial++) {
      const got = nextPlanChange(jordan, "vote");
      const started = performance.now();
      const choice = trial % 2 === 0 ? "REJECT" : "APPROVE"; // stay below a majority so voting stays open
      const res = await api("POST", `/trips/${t.miami}/plan/vote`, u.maya, { choice });
      expect(res.status).toBe(200);
      const event = await got;
      expect(event).toEqual({ tripId: t.miami, reason: "vote" });
      expect(performance.now() - started).toBeLessThan(LIVE_LIMIT_MS);
    }
  });

  it("a preference save reaches the other members, and the readiness they reload shows it", async () => {
    const maya = await member(u.maya, t.miami);
    const got = nextPlanChange(maya, "preferences");
    expect((await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs)).status).toBe(200);
    await got;

    const readiness = await api("GET", `/trips/${t.miami}/readiness`, u.maya);
    expect(readiness.json.readyCount).toBe(3);
    expect(readiness.json.members.find((m: { userId: string }) => m.userId === u.alex).submitted).toBe(true);
  });

  it("generate, vote and join all push an update", async () => {
    const maya = await member(u.maya, t.miami);

    let got = nextPlanChange(maya, "generated");
    await api("POST", `/trips/${t.miami}/plan/generate`, u.alex);
    await got;

    got = nextPlanChange(maya, "vote");
    await api("POST", `/trips/${t.miami}/plan/vote`, u.jordan, { choice: "APPROVE" });
    await got;

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: t.miami } });
    got = nextPlanChange(maya, "member-joined");
    expect((await api("POST", `/join/${trip.inviteCode}`, outsider)).status).toBe(200);
    await got;
  });

  it("FR-103: the event carries no private preference values", async () => {
    const maya = await member(u.maya, t.miami);
    const got = nextPlanChange(maya, "preferences");
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    const event = await got;

    expect(Object.keys(event).sort()).toEqual(["reason", "tripId"]);
    const raw = JSON.stringify(event);
    for (const secret of ["1500", "IND", "2027-03-12", "2027-03-20", "nightlife"]) expect(raw).not.toContain(secret);
  });

  it("members of a different trip do not get the update", async () => {
    // Nashville and Miami share members, so connect Sam to Nashville only
    const samOnNashville = await member(u.sam, t.nash);
    const quiet = noPlanChange(samOnNashville);
    await api("PUT", `/trips/${t.miami}/preferences/me`, u.alex, alexPrefs);
    await quiet;
  });

  it("a non-member socket is refused and never hears the trip's updates", async () => {
    const refused = await new Promise<Error>((resolve, reject) => {
      const s = connect(baseUrl, { auth: { userId: outsider, tripId: t.miami }, transports: ["websocket"] });
      open.push(s);
      s.once("connect_error", resolve);
      s.once("connect", () => reject(new Error("non-member was allowed to connect")));
    });
    expect(refused.message).toBe("forbidden");

    const noUser = await new Promise<Error>((resolve) => {
      const s = connect(baseUrl, { auth: { tripId: t.miami }, transports: ["websocket"] });
      open.push(s);
      s.once("connect_error", resolve);
    });
    expect(noUser.message).toBe("unauthorized");
  });
});
