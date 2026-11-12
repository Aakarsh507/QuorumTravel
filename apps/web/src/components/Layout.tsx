import type { ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Compass,
  Hotel,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  MessageCircleMore,
  PlaneTakeoff,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import { api, type TripDetail } from "../api";
import { useLoad, useSession } from "../session";
import { Avatar } from "./Design";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Quorum home">
      <div className="logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <strong>quorum</strong>
    </Link>
  );
}
function UserSwitcher() {
  const { users, userId, setUserId, user } = useSession();
  return (
    <div className="q-who">
      <Avatar name={user?.displayName ?? "Traveler"} small />
      <label htmlFor="user-switch" className="sr-only">
        Viewing as (demo user)
      </label>
      <select
        id="user-switch"
        aria-label="Viewing as (demo user)"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
      <span className="q-dev-tag">Demo</span>
    </div>
  );
}
export function AppShell() {
  const { error, userId } = useSession();
  const { pathname } = useLocation();
  const inTrip =
    /^\/trips\/[^/]+(?:\/(?!setup).*)?$/.test(pathname) &&
    pathname !== "/trips/new";
  return (
    <div className="q-app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {!inTrip && (
        <header className="dashboard-header">
          <Logo />
          <UserSwitcher />
        </header>
      )}
      {error && (
        <p role="alert" className="q-banner q-banner-error q-wrap">
          {error}
        </p>
      )}
      {userId && <Outlet />}
    </div>
  );
}
const NAV = [
  { to: ".", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "plan", label: "Group plan", icon: Sparkles },
  { to: "flights", label: "Flights", icon: PlaneTakeoff },
  { to: "stays", label: "Stays", icon: Hotel },
  { to: "itinerary", label: "Itinerary", icon: ListChecks },
  { to: "explore", label: "Explore", icon: Compass },
  { to: "assistant", label: "AI Assistant", icon: MessageCircleMore },
  { to: "expenses", label: "Expenses", icon: WalletCards },
  { to: "members", label: "Members", icon: Users },
];
export interface TripContext {
  trip: TripDetail;
  reloadTrip: () => void;
}
export function TripLayout() {
  const { tripId = "" } = useParams();
  const { userId } = useSession();
  const {
    data: trip,
    error,
    reload,
  } = useLoad(() => api.trip(userId, tripId), [userId, tripId]);
  const overviewActive = /\/trips\/[^/]+\/?(preferences)?$/.test(
    useLocation().pathname,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <Link className="all-trips" to="/">
          <ArrowLeft size={16} /> My trips
        </Link>
        <nav aria-label="Trip sections">
          {NAV.map(({ icon: Icon, ...n }) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                (n.end ? overviewActive : isActive) ? "active" : undefined
              }
            >
              <Icon size={19} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-help">
          <div className="help-icon">
            <LockKeyhole size={18} />
          </div>
          <strong>Planning tip</strong>
          <p>Your group’s private details stay private.</p>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-header">
          <div>
            <p className="eyebrow">CURRENT TRIP</p>
            <Link className="trip-switcher" to="/">
              {trip?.name ?? "Loading trip…"}
              <ChevronDown size={16} />
            </Link>
          </div>
          <div className="header-actions">
            {trip && (
              <div className="members-inline">
                <div className="avatar-stack">
                  {trip.members.slice(0, 5).map((m) => (
                    <Avatar key={m.userId} name={m.displayName} small />
                  ))}
                </div>
                <span>{trip.members.length} travelers</span>
              </div>
            )}
            <UserSwitcher />
          </div>
        </header>
        <main id="main" className="page-content">
          {error && (
            <p role="alert" className="q-banner q-banner-error">
              {error}
            </p>
          )}
          {trip && (
            <Outlet
              context={{ trip, reloadTrip: reload } satisfies TripContext}
            />
          )}
        </main>
      </div>
    </div>
  );
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  const mapped: Record<string, string> = {
    good: "green",
    info: "blue",
    warn: "amber",
    onDark: "teal",
  };
  return (
    <span className={`pill pill-${mapped[tone] ?? tone}`}>{children}</span>
  );
}
