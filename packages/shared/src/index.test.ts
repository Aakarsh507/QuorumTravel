import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  canonicalize,
  findConflicts,
  hashItinerary,
  itemInputSchema,
  sortItinerary,
  type ItineraryItem,
} from "./index";

function item(over: Partial<ItineraryItem> & { id: string }): ItineraryItem {
  return {
    tripId: "t1",
    type: "ACTIVITY",
    title: over.id,
    startAt: "2027-06-02T10:00:00.000Z",
    endAt: "2027-06-02T12:00:00.000Z",
    timezone: "UTC",
    location: "",
    status: "CONFIRMED",
    version: 1,
    participantIds: [],
    createdById: "u1",
    lastEditedById: "u1",
    lastEditedByName: "Ada",
    updatedAt: "2027-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("sortItinerary (FR-401)", () => {
  it("orders by start, then end, then id, regardless of input order", () => {
    const a = item({ id: "a", startAt: "2027-06-02T09:00:00.000Z", endAt: "2027-06-02T10:00:00.000Z" });
    const b = item({ id: "b", startAt: "2027-06-02T09:00:00.000Z", endAt: "2027-06-02T11:00:00.000Z" });
    const c = item({ id: "c", startAt: "2027-06-01T09:00:00.000Z", endAt: "2027-06-01T10:00:00.000Z" });
    const d = item({ id: "d", startAt: "2027-06-02T09:00:00.000Z", endAt: "2027-06-02T11:00:00.000Z" });
    const expected = ["c", "a", "b", "d"];
    expect(sortItinerary([d, b, a, c]).map((i) => i.id)).toEqual(expected);
    expect(sortItinerary([a, b, c, d]).map((i) => i.id)).toEqual(expected);
  });
});

describe("findConflicts (FR-405)", () => {
  it("flags both items of an overlapping pair", () => {
    const a = item({ id: "a", startAt: "2027-06-02T10:00:00.000Z", endAt: "2027-06-02T12:00:00.000Z" });
    const b = item({ id: "b", startAt: "2027-06-02T11:00:00.000Z", endAt: "2027-06-02T13:00:00.000Z" });
    expect(findConflicts([a, b])).toEqual(["a", "b"]);
  });

  it("does not flag non-overlapping or back-to-back items", () => {
    const a = item({ id: "a", startAt: "2027-06-02T10:00:00.000Z", endAt: "2027-06-02T12:00:00.000Z" });
    const b = item({ id: "b", startAt: "2027-06-02T12:00:00.000Z", endAt: "2027-06-02T13:00:00.000Z" });
    const c = item({ id: "c", startAt: "2027-06-03T10:00:00.000Z", endAt: "2027-06-03T11:00:00.000Z" });
    expect(findConflicts([a, b, c])).toEqual([]);
  });

  it("only conflicts when the items share a member", () => {
    const a = item({ id: "a", participantIds: ["u1"] });
    const b = item({ id: "b", participantIds: ["u2"] });
    const c = item({ id: "c", participantIds: ["u2", "u3"] });
    expect(findConflicts([a, b])).toEqual([]);
    expect(findConflicts([a, b, c])).toEqual(["b", "c"]);
  });

  it("treats an empty participant list as the whole group", () => {
    const a = item({ id: "a", participantIds: [] });
    const b = item({ id: "b", participantIds: ["u2"] });
    expect(findConflicts([a, b])).toEqual(["a", "b"]);
  });

  it("lodging only conflicts with other lodging", () => {
    const stay = item({
      id: "stay",
      type: "LODGING",
      startAt: "2027-06-01T15:00:00.000Z",
      endAt: "2027-06-05T11:00:00.000Z",
    });
    const act = item({ id: "act" });
    const stay2 = item({
      id: "stay2",
      type: "LODGING",
      startAt: "2027-06-04T15:00:00.000Z",
      endAt: "2027-06-06T11:00:00.000Z",
    });
    expect(findConflicts([stay, act])).toEqual([]);
    expect(findConflicts([stay, act, stay2])).toEqual(["stay", "stay2"]);
  });

  it("clears when the overlapping item is removed", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b" });
    expect(findConflicts([a, b])).toEqual(["a", "b"]);
    expect(findConflicts([a])).toEqual([]);
  });
});

describe("hashing (NFR-403)", () => {
  it("canonicalize ignores key order", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it("same items in any order produce the same hash; a change alters it", async () => {
    const items = [item({ id: "a" }), item({ id: "b", startAt: "2027-06-03T10:00:00.000Z", endAt: "2027-06-03T11:00:00.000Z" })];
    const h1 = await hashItinerary(items, []);
    const h2 = await hashItinerary([...items].reverse(), []);
    const h3 = await hashItinerary([items[0]!, { ...items[1]!, title: "changed" }], []);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("buildSnapshot sorts, flags conflicts and hashes", async () => {
    const snap = await buildSnapshot("t1", 3, [item({ id: "b" }), item({ id: "a" })]);
    expect(snap.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(snap.conflictIds).toEqual(["a", "b"]);
    expect(snap.hash).toBe(await hashItinerary(snap.items, snap.conflictIds));
  });
});

describe("itemInputSchema", () => {
  const base = { type: "ACTIVITY", title: "Dinner", startAt: "2027-06-02T18:00:00Z", endAt: "2027-06-02T20:00:00Z" };
  it("accepts a valid item and normalises dates", () => {
    const r = itemInputSchema.parse(base);
    expect(r.startAt).toBe("2027-06-02T18:00:00.000Z");
    expect(r.participantIds).toEqual([]);
  });
  it("rejects end before start and empty titles", () => {
    expect(itemInputSchema.safeParse({ ...base, endAt: "2027-06-02T17:00:00Z" }).success).toBe(false);
    expect(itemInputSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
  });
});
