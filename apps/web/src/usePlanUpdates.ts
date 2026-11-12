import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_EVENTS, type PlanChangedEvent } from "@quorum/shared";
import { SERVER_URL } from "./api";

export type LiveState = "connecting" | "live" | "offline";

/**
 * SYS-02 live updates for the Group plan screens. Replaces the old 3-second
 * polling: the server pushes `plan:changed` to the trip's room whenever a
 * member saves preferences, joins, a plan is generated or someone votes, and
 * we call `onChange` so the page re-fetches readiness and the plan.
 *
 * The event carries no data on purpose (FR-103), so every client reloads its
 * own view through the normal guarded REST routes.
 *
 * After a reconnect we also call `onChange`, because events sent while the
 * socket was down are not replayed.
 */
export function usePlanUpdates(userId: string, tripId: string, onChange: () => void): LiveState {
  const [state, setState] = useState<LiveState>("connecting");

  // keep the latest callback without reconnecting the socket on every render
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!userId) return;
    setState("connecting");
    let connectedBefore = false;
    const socket = io(SERVER_URL, { auth: { userId, tripId } });

    socket.on("connect", () => {
      setState("live");
      if (connectedBefore) onChangeRef.current(); // catch up on anything missed while offline
      connectedBefore = true;
    });
    socket.on("disconnect", () => setState("offline"));
    socket.on("connect_error", () => setState("offline"));
    socket.on(SOCKET_EVENTS.planChanged, (e: PlanChangedEvent) => {
      if (e.tripId === tripId) onChangeRef.current();
    });

    return () => {
      socket.close();
    };
  }, [userId, tripId]);

  return state;
}
