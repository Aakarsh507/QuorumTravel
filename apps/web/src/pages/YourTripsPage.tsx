import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Plus,
  Settings2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, type TripSummary } from "../api";
import { Pill } from "../components/Layout";
import {
  date,
  DestinationImage,
  destinationVisual,
  PageTitle,
} from "../components/Design";
import { useLoad, useSession } from "../session";

function TripCard({ trip }: { trip: TripSummary }) {
  const { userId } = useSession();
  const { data } = useLoad(() => api.plan(userId, trip.id), [userId, trip.id]);
  const result = data?.plan?.result;
  const match = result?.feasible ? result : null;
  const destination =
    match?.destination.city ??
    destinationVisual(trip.name) ??
    "Destination to be decided";
  const next =
    trip.status.tone === "good"
      ? "Review your shared itinerary"
      : trip.status.tone === "info"
        ? "Review and vote on the group plan"
        : trip.status.tone === "warn"
          ? "Review the plan and your preferences"
          : "Submit your travel preferences";
  return (
    <article className="trip-card">
      <div className="trip-image">
        <DestinationImage name={destination} />
        <Pill tone={trip.status.tone}>{trip.status.label}</Pill>
      </div>
      <div className="trip-body">
        <div>
          <p className="eyebrow">{destination}</p>
          <h3>{trip.name}</h3>
        </div>
        <div className="trip-meta">
          <span>
            <CalendarDays size={17} />
            {match
              ? `${date(match.startDate)} – ${date(match.endDate)}`
              : "Dates being finalized"}
          </span>
          <span>
            <Users size={17} />
            {trip.memberCount} members
          </span>
        </div>
        <div className="next-action">
          <span>NEXT STEP</span>
          <strong>{next}</strong>
        </div>
        <Link className="btn btn-secondary btn-md" to={`/trips/${trip.id}`}>
          View trip <ArrowRight size={16} />
        </Link>
      </div>
    </article>
  );
}
export function YourTripsPage() {
  const { userId, user } = useSession();
  const { data: trips, error } = useLoad(() => api.myTrips(userId), [userId]);
  const [join, setJoin] = useState(false);
  const [code, setCode] = useState("");
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();
  const planning = trips?.filter((t) => t.status.tone !== "good").length ?? 0;
  const action =
    trips?.filter((t) => t.status.tone === "warn" || t.status.tone === "info")
      .length ?? 0;
  return (
    <main id="main" className="dashboard-content">
      <PageTitle
        title={`Welcome back${user ? `, ${user.displayName.split(" ")[0]}` : ""}!`}
        subtitle="Your next adventure starts here."
        action={
          <div className="title-actions">
            <button
              className="btn btn-secondary btn-md"
              onClick={() => setJoin(true)}
            >
              <UserPlus size={17} />
              Join trip
            </button>
            <Link to="/trips/new" className="btn btn-primary btn-md">
              <Plus size={17} />
              Create new trip
            </Link>
          </div>
        }
      />
      {error && (
        <p role="alert" className="q-banner q-banner-error">
          {error}
        </p>
      )}
      {!trips && !error && <p role="status">Loading your trips…</p>}
      <div className="summary-row">
        <div>
          <span>Your trips</span>
          <strong>{trips?.length ?? "—"}</strong>
          <p>Across your groups</p>
        </div>
        <div>
          <span>Trips in planning</span>
          <strong>{trips ? planning : "—"}</strong>
          <p>Bring everyone’s preferences together</p>
        </div>
        <div className="attention">
          <span>Ready for review</span>
          <strong>{trips ? action : "—"}</strong>
          <p>Vote or revise preferences</p>
        </div>
      </div>
      <section className="trip-section">
        <div className="section-heading">
          <div>
            <h2>Your trips</h2>
            <p>Keep planning where you left off.</p>
          </div>
          <label className="filter-btn">
            <Settings2 size={16} />
            <span className="sr-only">Filter trips</span>
            <select
              aria-label="Filter trips"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All trips</option>
              <option value="planning">In planning</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
        </div>
        <div className="trip-grid">
          {trips
            ?.filter(
              (t) =>
                filter === "all" ||
                (filter === "confirmed"
                  ? t.status.tone === "good"
                  : t.status.tone !== "good"),
            )
            .map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
        </div>
        {trips?.length === 0 && (
          <div className="empty-state">
            <h3>Your next adventure starts here</h3>
            <p>Create a trip or join one with an invitation code.</p>
            <Link className="btn btn-primary btn-md" to="/trips/new">
              Plan your first trip
            </Link>
          </div>
        )}
      </section>
      {join && (
        <div className="modal-backdrop" onClick={() => setJoin(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="join-title">Join a trip</h2>
              <button
                className="icon-btn"
                onClick={() => setJoin(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <form
              className="modal-body"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim())
                  navigate(`/join/${encodeURIComponent(code.trim())}`);
              }}
            >
              <p className="modal-intro">
                Enter an invitation code from your group organizer.
              </p>
              <label className="field">
                <span className="field-label">Invitation code</span>
                <input
                  className="input"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button className="btn btn-primary btn-md">Join trip</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
