import { z } from "zod";

export const ITEM_TYPES = ["FLIGHT", "LODGING", "ACTIVITY"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_STATUSES = ["CONFIRMED", "PROPOSED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ItineraryItem {
  id: string;
  tripId: string;
  type: ItemType;
  title: string;
  startAt: string; // ISO 8601, UTC
  endAt: string; // ISO 8601, UTC
  timezone: string; // IANA zone used for display, e.g. "Europe/Paris"
  location: string;
  status: ItemStatus;
  version: number; // per-item version for optimistic concurrency
  /** Member ids the item applies to. Empty = the whole group. */
  participantIds: string[];
  createdById: string;
  lastEditedById: string;
  lastEditedByName: string;
  updatedAt: string;
}

export interface ItinerarySnapshot {
  tripId: string;
  version: number; // trip-level counter, bumped on every change
  items: ItineraryItem[]; // already sorted with sortItinerary
  conflictIds: string[];
  hash: string; // sha256 of canonical(items, conflictIds)
}

export const SOCKET_EVENTS = {
  snapshot: "itinerary:snapshot",
} as const;

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date-time")
  .transform((s) => new Date(s).toISOString());

export const itemInputSchema = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: z.string().trim().min(1, "Title is required").max(120),
    startAt: isoDate,
    endAt: isoDate,
    timezone: z.string().min(1).default("UTC"),
    location: z.string().trim().max(200).default(""),
    participantIds: z.array(z.string()).default([]),
  })
  .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
    message: "End must be after start",
    path: ["endAt"],
  });
export type ItemInput = z.infer<typeof itemInputSchema>;

export const itemPatchSchema = z.object({
  expectedVersion: z.number().int(),
  type: z.enum(ITEM_TYPES).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  startAt: isoDate.optional(),
  endAt: isoDate.optional(),
  timezone: z.string().min(1).optional(),
  location: z.string().trim().max(200).optional(),
  participantIds: z.array(z.string()).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
});
export type ItemPatch = z.infer<typeof itemPatchSchema>;

/** Order: start, then end, then id -> identical order on every client. */
export function sortItinerary<T extends Pick<ItineraryItem, "startAt" | "endAt" | "id">>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const s = Date.parse(a.startAt) - Date.parse(b.startAt);
    if (s !== 0) return s;
    const e = Date.parse(a.endAt) - Date.parse(b.endAt);
    if (e !== 0) return e;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

type ConflictItem = Pick<
  ItineraryItem,
  "id" | "type" | "startAt" | "endAt" | "participantIds"
>;

function sharesMember(a: ConflictItem, b: ConflictItem): boolean {
  // empty participant list means "everyone"
  if (a.participantIds.length === 0 || b.participantIds.length === 0) return true;
  return a.participantIds.some((p) => b.participantIds.includes(p));
}

/**
 * FR-405: two items conflict when they share a member and their time windows
 * intersect (touching end/start is not an overlap). Lodging spans the whole
 * stay, so it only conflicts with other lodging.
 */
export function findConflicts(items: readonly ConflictItem[]): string[] {
  const ids = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if ((a.type === "LODGING") !== (b.type === "LODGING")) continue;
      if (!sharesMember(a, b)) continue;
      if (Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt)) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
  }
  return [...ids].sort();
}

/** Stable JSON: object keys sorted, arrays keep order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** NFR-403: hash of exactly what a client renders. */
export function hashItinerary(
  items: readonly ItineraryItem[],
  conflictIds: readonly string[],
): Promise<string> {
  return sha256Hex(canonicalize({ items: sortItinerary(items), conflictIds: [...conflictIds].sort() }));
}

export async function buildSnapshot(
  tripId: string,
  version: number,
  rawItems: readonly ItineraryItem[],
): Promise<ItinerarySnapshot> {
  const items = sortItinerary(rawItems);
  const conflictIds = findConflicts(items);
  return { tripId, version, items, conflictIds, hash: await hashItinerary(items, conflictIds) };
}

export * from "./airports";
export * from "./planning";
