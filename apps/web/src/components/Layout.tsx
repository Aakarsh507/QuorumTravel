import type { ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { api, type TripDetail } from "../api";
import { useLoad, useSession } from "../session";

export function Logo() {
  return (
    <Link to="/" className="q-logo" aria-label="Quorum home">
      <span className="q-logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      quorum
    </Link>
  );
}

/** White top bar from the Figma frames, plus the dev "Viewing as" switcher. */
export function AppShell() {
  const { users, userId, setUserId, error } = useSession();
  return (
    <div className="q-app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="q-header">
        <Logo />
        <div className="q-who">
          <label htmlFor="user-switch">Viewing as</label>
          <select id="user-switch" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
          <span className="q-dev-tag" title="Stand-in for login until SYS-07 is built">dev login</span>
        </div>
      </header>
      {error && <p role="alert" className="q-banner q-banner-error q-wrap">{error}</p>}
      {userId && <Outlet />}
    </div>
  );
}

const NAV = [
  { to: ".", label: "Overview", end: true },
  { to: "plan", label: "Group plan" },
  { to: "flights", label: "Flights" },
  { to: "stays", label: "Stays" },
  { to: "itinerary", label: "Itinerary" },
];

export interface TripContext {
  trip: TripDetail;
  reloadTrip: () => void;
}

/** Trip pages: left sidebar (Overview, Group plan, Flights, Stays, Itinerary). */
export function TripLayout() {
  const { tripId = "" } = useParams();
  const { userId } = useSession();
  const { data: trip, error, reload } = useLoad(() => api.trip(userId, tripId), [userId, tripId]);
  // "My travel preferences" lives under Overview in the Figma flow
  const overviewActive = /\/trips\/[^/]+\/?(preferences)?$/.test(useLocation().pathname);

  return (
    <div className="q-trip">
      <nav className="q-side" aria-label="Trip sections">
        {NAV.map((n) => (
          <NavLink
            key={n.label}
            to={n.to}
            end={n.end}
            className={({ isActive }) => ((n.end ? overviewActive : isActive) ? "active" : undefined)}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main id="main" className="q-trip-main">
        {error && <p role="alert" className="q-banner q-banner-error">{error}</p>}
        {trip && <Outlet context={{ trip, reloadTrip: reload } satisfies TripContext} />}
      </main>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="q-eyebrow">{children}</p>;
}

export function Pill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={`q-pill q-pill-${tone}`}>{children}</span>;
}
