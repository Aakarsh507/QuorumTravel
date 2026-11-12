import { Link } from "react-router-dom";
import { api } from "../api";
import { Pill } from "../components/Layout";
import { useLoad, useSession } from "../session";

const COVERS = ["q-cover-blue", "q-cover-green", "q-cover-yellow", "q-cover-pink"];

/** Workflow 1 · Screen 1 — "Your trips": dashboard and the Create new trip entry point. */
export function YourTripsPage() {
  const { userId, user } = useSession();
  const { data: trips, error } = useLoad(() => api.myTrips(userId), [userId]);
  const first = user?.displayName.split(" ")[0] ?? "";

  return (
    <main id="main" className="q-page q-wrap">
      <div className="q-page-head">
        <h1>Welcome back{first && `, ${first}`}!</h1>
        <Link to="/trips/new" className="q-btn q-btn-primary">Create new trip</Link>
      </div>

      {error && <p role="alert" className="q-banner q-banner-error">{error}</p>}
      {trips && trips.length === 0 && (
        <div className="q-empty">
          <p>You aren't part of any trips yet.</p>
          <Link to="/trips/new" className="q-btn q-btn-primary">Plan your first trip</Link>
        </div>
      )}

      <ul className="q-trip-grid">
        {trips?.map((t, i) => (
          <li key={t.id} className="q-trip-card">
            <div className={`q-cover ${COVERS[i % COVERS.length]}`} aria-hidden="true" />
            <div className="q-trip-card-body">
              <h2>{t.name}</h2>
              <Pill tone={t.status.tone}>{t.status.label}</Pill>
              <p className="q-muted q-small">
                {t.memberCount} traveler{t.memberCount === 1 ? "" : "s"} · {t.role === "CREATOR" ? "you organize" : "member"}
              </p>
              <Link to={`/trips/${t.id}`} className="q-link">View trip</Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
