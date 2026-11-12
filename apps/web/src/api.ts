import type {
  ItemInput,
  ItemPatch,
  ItineraryItem,
  ItinerarySnapshot,
  PlanResult,
  PlanStatus,
  Preference,
  PreferenceInput,
  VoteChoice,
} from "@quorum/shared";

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

export interface TripStatus {
  label: string;
  tone: "good" | "info" | "warn" | "neutral";
}
export interface TripSummary {
  id: string;
  name: string;
  role: "CREATOR" | "MEMBER";
  memberCount: number;
  status: TripStatus;
}
export interface TripDetail {
  id: string;
  name: string;
  inviteCode: string;
  me: { userId: string; displayName: string; role: "CREATOR" | "MEMBER" };
  members: { userId: string; displayName: string; role: "CREATOR" | "MEMBER" }[];
  invites: { email: string; status: "INVITED" }[];
  status: TripStatus;
}
export interface Readiness {
  memberCount: number;
  readyCount: number;
  members: { userId: string; displayName: string; role: "CREATOR" | "MEMBER"; submitted: boolean }[];
  canGenerate: boolean;
  minimumToGenerate: number;
}
export interface PlanView {
  plan: {
    id: string;
    status: PlanStatus;
    result: PlanResult;
    createdAt: string;
    approvals: number;
    rejections: number;
    memberCount: number;
    needed: number;
    myVote: VoteChoice | null;
  } | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** FR-102 field-level messages, keyed by path such as "dateRanges.0.end". */
    public fields: Record<string, string> = {},
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
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`, json?.fields);
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

  // ---- SYS-01 / SYS-02 (Workflow 1: group trip planning)
  myTrips: (uid: string) => request<TripSummary[]>("GET", "/me/trips", uid),
  createTrip: (uid: string, name: string) =>
    request<{ id: string; name: string; inviteCode: string }>("POST", "/trips", uid, { name }),
  trip: (uid: string, tripId: string) => request<TripDetail>("GET", `/trips/${tripId}`, uid),
  invite: (uid: string, tripId: string, emails: string[]) =>
    request<TripDetail["invites"]>("POST", `/trips/${tripId}/invites`, uid, { emails }),
  join: (uid: string, code: string) => request<{ tripId: string; name: string }>("POST", `/join/${code}`, uid),
  myPreference: (uid: string, tripId: string) =>
    request<{ preference: Preference | null }>("GET", `/trips/${tripId}/preferences/me`, uid),
  savePreference: (uid: string, tripId: string, p: PreferenceInput) =>
    request<{ preference: Preference }>("PUT", `/trips/${tripId}/preferences/me`, uid, p),
  readiness: (uid: string, tripId: string) => request<Readiness>("GET", `/trips/${tripId}/readiness`, uid),
  plan: (uid: string, tripId: string) => request<PlanView>("GET", `/trips/${tripId}/plan`, uid),
  generatePlan: (uid: string, tripId: string) => request<PlanView>("POST", `/trips/${tripId}/plan/generate`, uid),
  vote: (uid: string, tripId: string, choice: VoteChoice) =>
    request<PlanView>("POST", `/trips/${tripId}/plan/vote`, uid, { choice }),
};
