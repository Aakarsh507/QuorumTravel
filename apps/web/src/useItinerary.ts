import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_EVENTS, hashItinerary, type ItinerarySnapshot } from "@quorum/shared";
import { SERVER_URL, api, type Me, type Member } from "./api";

export type SyncState = "connecting" | "live" | "offline" | "mismatch";

/** Loads the itinerary, then keeps it live over Socket.IO (FR-402). */
export function useItinerary(userId: string, tripId: string) {
  const [snapshot, setSnapshot] = useState<ItinerarySnapshot | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [sync, setSync] = useState<SyncState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.itinerary(userId, tripId);
      setSnapshot(r.snapshot);
      setMe(r.me);
      setMembers(r.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load itinerary");
    }
  }, [userId, tripId]);

  useEffect(() => {
    setSnapshot(null);
    setSync("connecting");
    void reload();
    const socket = io(SERVER_URL, { auth: { userId, tripId } });
    socket.on("connect", () => setSync("live"));
    socket.on("disconnect", () => setSync("offline"));
    socket.on("connect_error", () => setSync("offline"));
    socket.on(SOCKET_EVENTS.snapshot, async (s: ItinerarySnapshot) => {
      // NFR-403: recompute the hash of what we are about to render
      const local = await hashItinerary(s.items, s.conflictIds);
      if (local !== s.hash) {
        setSync("mismatch");
        void reload();
        return;
      }
      setSnapshot(s);
      setSync("live");
      void reload(); // refresh permissions / member list too
    });
    return () => {
      socket.close();
    };
  }, [userId, tripId, reload]);

  return { snapshot, me, members, sync, error, reload };
}
