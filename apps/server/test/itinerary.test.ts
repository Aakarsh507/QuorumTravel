import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { io as connect, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { SOCKET_EVENTS, hashItinerary, type ItinerarySnapshot } from "@quorum/shared";
import { createApp } from "../src/app";
import { seed } from "../prisma/seed";

const prisma = new PrismaClient();
let server: Awaited<ReturnType<typeof createApp>>;
let baseUrl: string;
let tripId: string;
let u: { ada: string; ben: string; cy: string; dee: string };
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
  const s = await seed(prisma);
  tripId = s.tripId;
  u = s.users;
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
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const newItem = (over: Record<string, unknown> = {}) => ({
  type: "ACTIVITY",
  title: "Museum",
  startAt: "2027-06-06T09:00:00Z",
  endAt: "2027-06-06T11:00:00Z",
  ...over,
});

function connectClient(userId: string, id = tripId) {
  return new Promise<{ socket: Socket; first: ItinerarySnapshot }>((resolve, reject) => {
    const socket = connect(baseUrl, { auth: { userId, tripId: id }, transports: ["websocket"] });
    socket.once(SOCKET_EVENTS.snapshot, (first: ItinerarySnapshot) => resolve({ socket, first }));
    socket.once("connect_error", reject);
  });
}
const nextSnapshot = (s: Socket) =>
  new Promise<ItinerarySnapshot>((resolve) => s.once(SOCKET_EVENTS.snapshot, resolve));

describe("FR-401 consolidated itinerary", () => {
  it("returns the seeded fixture in chronological order to 3 members, 5 runs", async () => {
    for (let run = 0; run < 5; run++) {
      for (const user of [u.ada, u.ben, u.dee]) {
        const { status, json } = await api("GET", `/trips/${tripId}/itinerary`, user);
        expect(status).toBe(200);
        const items = json.snapshot.items as { type: string; startAt: string; status: string }[];
        const confirmed = items.filter((i) => i.status === "CONFIRMED");
        expect(confirmed.map((i) => i.type).sort()).toEqual(
          ["ACTIVITY", "ACTIVITY", "ACTIVITY", "FLIGHT", "FLIGHT", "LODGING"],
        );
        const starts = items.map((i) => Date.parse(i.startAt));
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      }
    }
  });
});

describe("access control", () => {
  it("rejects unauthenticated and non-member requests", async () => {
    expect((await api("GET", `/trips/${tripId}/itinerary`, null)).status).toBe(401);
    expect((await api("GET", `/trips/${tripId}/itinerary`, outsider)).status).toBe(403);
    expect((await api("POST", `/trips/${tripId}/items`, outsider, newItem())).status).toBe(403);
  });

  it("refuses socket connections from non-members and anonymous users", async () => {
    await expect(connectClient(outsider)).rejects.toThrow("forbidden");
    await expect(connectClient("nobody")).rejects.toThrow("unauthorized");
  });
});

describe("role-based permissions", () => {
  it("creator and authorised member add CONFIRMED items; others only PROPOSE", async () => {
    const byCreator = await api("POST", `/trips/${tripId}/items`, u.ada, newItem());
    const byEditor = await api("POST", `/trips/${tripId}/items`, u.ben, newItem({ title: "Ben's pick" }));
    const byMember = await api("POST", `/trips/${tripId}/items`, u.cy, newItem({ title: "Cy's idea" }));
    expect([byCreator.status, byEditor.status, byMember.status]).toEqual([201, 201, 201]);
    expect(byCreator.json.status).toBe("CONFIRMED");
    expect(byEditor.json.status).toBe("CONFIRMED");
    expect(byMember.json.status).toBe("PROPOSED");
  });

  it("plain members cannot edit/delete others' items or confirm anything", async () => {
    const snap = (await api("GET", `/trips/${tripId}/itinerary`, u.cy)).json.snapshot as ItinerarySnapshot;
    const confirmed = snap.items.find((i) => i.status === "CONFIRMED")!;
    const proposal = snap.items.find((i) => i.status === "PROPOSED")!; // Cy's own
    expect((await api("PATCH", `/trips/${tripId}/items/${confirmed.id}`, u.cy, { expectedVersion: confirmed.version, title: "x" })).status).toBe(403);
    expect((await api("DELETE", `/trips/${tripId}/items/${confirmed.id}`, u.cy)).status).toBe(403);
    // own proposal: may edit, may not self-confirm
    expect((await api("PATCH", `/trips/${tripId}/items/${proposal.id}`, u.cy, { expectedVersion: proposal.version, title: "Fado night" })).status).toBe(200);
    expect((await api("PATCH", `/trips/${tripId}/items/${proposal.id}`, u.cy, { expectedVersion: proposal.version + 1, status: "CONFIRMED" })).status).toBe(403);
    // someone else's proposal is off-limits
    expect((await api("PATCH", `/trips/${tripId}/items/${proposal.id}`, u.dee, { expectedVersion: proposal.version + 1, title: "hijack" })).status).toBe(403);
  });

  it("creator can confirm a proposal and reject (delete) one", async () => {
    const snap = (await api("GET", `/trips/${tripId}/itinerary`, u.ada)).json.snapshot as ItinerarySnapshot;
    const proposal = snap.items.find((i) => i.status === "PROPOSED")!;
    const ok = await api("PATCH", `/trips/${tripId}/items/${proposal.id}`, u.ada, { expectedVersion: proposal.version, status: "CONFIRMED" });
    expect(ok.json.status).toBe("CONFIRMED");
    expect((await api("DELETE", `/trips/${tripId}/items/${proposal.id}`, u.ada)).status).toBe(204);
  });

  it("only the creator grants or revokes edit permission", async () => {
    expect((await api("PATCH", `/trips/${tripId}/members/${u.cy}`, u.ben, { canEdit: true })).status).toBe(403);
    expect((await api("PATCH", `/trips/${tripId}/members/${u.cy}`, u.ada, { canEdit: true })).status).toBe(200);
    expect((await api("POST", `/trips/${tripId}/items`, u.cy, newItem())).json.status).toBe("CONFIRMED");
    await api("PATCH", `/trips/${tripId}/members/${u.cy}`, u.ada, { canEdit: false });
    expect((await api("POST", `/trips/${tripId}/items`, u.cy, newItem())).json.status).toBe("PROPOSED");
    expect((await api("PATCH", `/trips/${tripId}/members/${u.ada}`, u.ada, { canEdit: false })).status).toBe(400);
  });
});

describe("validation", () => {
  it("rejects bad input and stores nothing", async () => {
    const before = (await prisma.itineraryItem.count());
    const bad = [
      newItem({ endAt: "2027-06-06T08:00:00Z" }), // end before start
      newItem({ title: "   " }),
      newItem({ participantIds: [outsider] }), // not a trip member
      newItem({ type: "HELICOPTER" }),
    ];
    for (const b of bad) expect((await api("POST", `/trips/${tripId}/items`, u.ada, b)).status).toBe(400);
    expect(await prisma.itineraryItem.count()).toBe(before);
  });
});

describe("concurrent edits", () => {
  it("a stale edit gets 409 and the first edit is preserved", async () => {
    const snap = (await api("GET", `/trips/${tripId}/itinerary`, u.ada)).json.snapshot as ItinerarySnapshot;
    const item = snap.items.find((i) => i.type === "FLIGHT")!;
    const first = await api("PATCH", `/trips/${tripId}/items/${item.id}`, u.ada, { expectedVersion: item.version, title: "Edited by Ada" });
    const second = await api("PATCH", `/trips/${tripId}/items/${item.id}`, u.ben, { expectedVersion: item.version, title: "Edited by Ben" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const stored = await prisma.itineraryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.title).toBe("Edited by Ada");
  });
});

describe("FR-405 conflict flagging through the API", () => {
  it("flags the seeded Sintra / Fado overlap, then clears when removed", async () => {
    const get = async () => (await api("GET", `/trips/${tripId}/itinerary`, u.ada)).json.snapshot as ItinerarySnapshot;
    let snap = await get();
    const flagged = snap.items.filter((i) => snap.conflictIds.includes(i.id)).map((i) => i.title);
    expect(flagged.sort()).toEqual(["Fado dinner (proposed)", "Sintra day trip"]);
    const fado = snap.items.find((i) => i.title.startsWith("Fado"))!;
    await api("DELETE", `/trips/${tripId}/items/${fado.id}`, u.ada);
    snap = await get();
    expect(snap.conflictIds).toEqual([]);
  });
});

describe("FR-402 / NFR-401 / NFR-403 real-time sync", () => {
  it("FR-402: a change reaches two other sessions in < 5 s, 10 of 10 trials", async () => {
    const a = await connectClient(u.ada);
    const b = await connectClient(u.cy);
    const c = await connectClient(u.dee);
    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const waits = Promise.all([nextSnapshot(b.socket), nextSnapshot(c.socket)]);
      await api("POST", `/trips/${tripId}/items`, u.ada, newItem({ title: `Trial ${i}`, startAt: `2027-06-0${(i % 3) + 1}T0${i % 9}:00:00Z`, endAt: `2027-06-0${(i % 3) + 1}T0${i % 9}:30:00Z` }));
      await waits;
      latencies.push(performance.now() - t0);
    }
    [a, b, c].forEach((x) => x.socket.close());
    expect(latencies.filter((ms) => ms < 5000).length).toBe(10);
  });

  it("NFR-401: 10 clients, 20 updates -> p95 latency < 5 s", async () => {
    const members = [u.ada, u.ben, u.cy, u.dee];
    const clients = await Promise.all(Array.from({ length: 10 }, (_, i) => connectClient(members[i % 4]!)));
    const all: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const waits = clients.map(async (c) => {
        await nextSnapshot(c.socket);
        all.push(performance.now() - t0);
      });
      await api("POST", `/trips/${tripId}/items`, u.ada, newItem({ title: `Load ${i}` }));
      await Promise.all(waits);
    }
    clients.forEach((c) => c.socket.close());
    all.sort((x, y) => x - y);
    expect(all.length).toBe(200);
    expect(all[Math.floor(all.length * 0.95)]!).toBeLessThan(5000);
  });

  it("NFR-403: every client's itinerary hash is identical after 10 sync events", async () => {
    const clients = await Promise.all([u.ada, u.ben, u.cy, u.dee].map((x) => connectClient(x)));
    const latest = clients.map(() => null as ItinerarySnapshot | null);
    clients.forEach((c, i) => c.socket.on(SOCKET_EVENTS.snapshot, (s: ItinerarySnapshot) => (latest[i] = s)));
    for (let i = 0; i < 10; i++) {
      const waits = clients.map((c) => nextSnapshot(c.socket));
      await api("POST", `/trips/${tripId}/items`, u.ada, newItem({ title: `Sync ${i}`, startAt: `2027-06-06T${10 + i}:00:00Z`, endAt: `2027-06-06T${10 + i}:30:00Z` }));
      await Promise.all(waits);
    }
    const hashes = await Promise.all(latest.map((s) => hashItinerary(s!.items, s!.conflictIds)));
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toBe(latest[0]!.hash); // client-side recomputation matches server hash
    clients.forEach((c) => c.socket.close());
  });
});
