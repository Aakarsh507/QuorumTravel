import type { ItemInput, ItemPatch, ItineraryItem, ItinerarySnapshot } from "@quorum/shared";

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export interface DevUser {
  id: string;
  displayName: string;
  trips: { id: string; name: string; role: string }[];
}
export interface Me {
  userId: string;
  role: "CREATOR" | "MEMBER";
  canEdit: boolean;
  canManage: boolean;
}
export interface Member {
  userId: string;
  displayName: string;
  role: "CREATOR" | "MEMBER";
  canEdit: boolean;
}
export interface ItineraryResponse {
  snapshot: ItinerarySnapshot;
  me: Me;
  members: Member[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, userId: string, body?: unknown): Promise<T> {
  const res = await fetch(SERVER_URL + path, {
    method,
    headers: {
      "x-user-id": userId, // dev stand-in for the real session (SYS-07)
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  devUsers: () => fetch(`${SERVER_URL}/dev/users`).then((r) => r.json() as Promise<DevUser[]>),
  itinerary: (uid: string, tripId: string) => request<ItineraryResponse>("GET", `/trips/${tripId}/itinerary`, uid),
  create: (uid: string, tripId: string, item: Omit<ItemInput, never>) =>
    request<ItineraryItem>("POST", `/trips/${tripId}/items`, uid, item),
  patch: (uid: string, tripId: string, itemId: string, patch: ItemPatch) =>
    request<ItineraryItem>("PATCH", `/trips/${tripId}/items/${itemId}`, uid, patch),
  remove: (uid: string, tripId: string, itemId: string) =>
    request<null>("DELETE", `/trips/${tripId}/items/${itemId}`, uid),
  setCanEdit: (uid: string, tripId: string, memberId: string, canEdit: boolean) =>
    request<{ canEdit: boolean }>("PATCH", `/trips/${tripId}/members/${memberId}`, uid, { canEdit }),
};
