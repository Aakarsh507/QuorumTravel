import { useEffect, useState } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Eyebrow, Pill, type TripContext } from "../components/Layout";
import { useLoad, useSession } from "../session";

/** Trip "Overview" tab: status, members, and the entry to My travel preferences. */
export function TripOverviewPage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const { data } = useLoad(() => api.myPreference(userId, trip.id), [userId, trip.id]);
  const submitted = !!data?.preference;
  const isCreator = trip.me.role === "CREATOR";

  return (
    <section className="q-content" aria-labelledby="ov-title">
      <Eyebrow>Trip overview</Eyebrow>
      <div className="q-title-row">
        <h1 id="ov-title">{trip.name}</h1>
        <Pill tone={trip.status.tone}>{trip.status.label}</Pill>
      </div>

      <div className="q-highlight q-row">
        <span>{submitted ? "Your travel preferences are saved." : "Add your dates, budget and vibe so the planner can include you."}</span>
        <Link to="preferences" className="q-btn q-btn-primary q-btn-sm">{submitted ? "Edit my preferences" : "Add my preferences"}</Link>
      </div>

      <h2 className="q-h2">Travelers ({trip.members.length})</h2>
      <ul className="q-list">
        {trip.members.map((m) => (
          <li key={m.userId} className="q-list-row">
            {m.displayName}
            {m.role === "CREATOR" && <Pill>Organizer</Pill>}
          </li>
        ))}
        {trip.invites.map((i) => (
          <li key={i.email} className="q-list-row q-muted">
            {i.email}
            <span className="q-pill q-pill-amber">Invited</span>
          </li>
        ))}
      </ul>

      <div className="q-actions">
        {isCreator && <Link to={`/trips/${trip.id}/setup/invite`} className="q-btn">Invite more people</Link>}
        <Link to="plan" className="q-btn q-btn-primary">Go to group plan</Link>
      </div>
    </section>
  );
}

/** Flights / Stays tabs: SYS-03 (Duffel / Booking.com search) is a later milestone. */
export function ComingSoonPage({ title, system }: { title: string; system: string }) {
  return (
    <section className="q-content">
      <Eyebrow>{system} · not in this prototype</Eyebrow>
      <h1>{title}</h1>
      <p className="q-muted">
        Search opens here once the group plan is confirmed. It is part of {system} and comes after this prototype.
      </p>
    </section>
  );
}

/** /join/:code — the share link from "Who's coming?". Joins as the current user. */
export function JoinPage() {
  const { code = "" } = useParams();
  const { userId } = useSession();
  const [tripId, setTripId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .join(userId, code)
      .then((r) => setTripId(r.tripId))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not join this trip"));
  }, [userId, code]);

  if (tripId) return <Navigate to={`/trips/${tripId}/preferences`} replace />;
  return (
    <main id="main" className="q-page q-wrap q-narrow">
      {error ? <p role="alert" className="q-banner q-banner-error">{error}</p> : <p>Joining trip…</p>}
    </main>
  );
}
