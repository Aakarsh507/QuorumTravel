import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  LockKeyhole,
  Sparkles,
  Users,
} from "lucide-react";
import {
  Avatar,
  date,
  DestinationImage,
  destinationVisual,
  money,
  PageTitle,
  PrivacyBanner,
  Progress,
} from "../components/Design";
import { ApiError, api } from "../api";
import { Pill, type TripContext } from "../components/Layout";
import { useLoad, useSession } from "../session";

/** Trip "Overview" tab: status, members, and the entry to My travel preferences. */
export function TripOverviewPage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const { data } = useLoad(
    () => api.myPreference(userId, trip.id),
    [userId, trip.id],
  );
  const readiness = useLoad(
    () => api.readiness(userId, trip.id),
    [userId, trip.id],
    3000,
  );
  const plan = useLoad(
    () => api.plan(userId, trip.id),
    [userId, trip.id],
    3000,
  );
  const itinerary = useLoad(
    () => api.itinerary(userId, trip.id),
    [userId, trip.id],
  );
  const p = plan.data?.plan;
  const result = p?.result.feasible ? p.result : null;
  const confirmed = p?.status === "CONFIRMED";
  const submitted = !!data?.preference;
  const isCreator = trip.me.role === "CREATOR";
  const destination =
    result?.destination.city ??
    destinationVisual(trip.name) ??
    "Your next adventure";
  const dates = result
    ? `${date(result.startDate)} – ${date(result.endDate)}`
    : "Dates being finalized";
  const current = confirmed
    ? 3
    : p?.status === "PROPOSED"
      ? 2
      : readiness.data?.canGenerate
        ? 1
        : 0;
  return (
    <section>
      <PageTitle
        eyebrow={destination}
        title={trip.name}
        subtitle={dates}
        action={
          <Link className="btn btn-secondary btn-md" to="preferences">
            {submitted ? "Edit my preferences" : "Add my preferences"}
          </Link>
        }
      />
      <div className="overview-hero">
        <DestinationImage name={destination} />
        <div className="hero-gradient">
          <Pill tone={trip.status.tone}>{trip.status.label}</Pill>
          <h2>{destination}</h2>
          <div>
            <span>
              <CalendarDays size={17} />
              {dates}
            </span>
            <div className="avatar-stack">
              {trip.members.map((m) => (
                <Avatar key={m.userId} name={m.displayName} small />
              ))}
            </div>
          </div>
        </div>
      </div>
      <Progress current={current} />
      <div className="overview-grid">
        <section className="next-card">
          <div className="spark-box">
            <Sparkles size={23} />
          </div>
          <div>
            <p className="eyebrow">WHAT HAPPENS NEXT?</p>
            <h2>
              {confirmed
                ? "Your plan is confirmed. Make it your own."
                : p?.status === "INFEASIBLE"
                  ? "A little flexibility can unlock this trip."
                  : p?.status === "PROPOSED"
                    ? "Your group plan is waiting for approval."
                    : "Bring the group’s preferences together."}
            </h2>
            <p>
              {confirmed
                ? "Review the shared itinerary and keep everyone on the same page."
                : "Add private preferences, find a plan that fits, and decide together."}
            </p>
            <Link
              className="btn btn-primary btn-md"
              to={confirmed ? "itinerary" : "plan"}
            >
              {confirmed ? "View itinerary" : "Review group plan"}
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
        <section className="stat-card">
          <div className="section-heading">
            <h3>Estimated cost</h3>
            <Pill>Demo estimate</Pill>
          </div>
          <strong className="big-number">
            {result ? money(result.perPersonCapUsd) : "—"}
          </strong>
          <p>estimated maximum per traveler</p>
          <div className="mini-breakdown">
            <span>
              Travelers <b>{trip.members.length}</b>
            </span>
            <span>
              Shared interests{" "}
              <b>{result?.sharedInterests.length ?? "Pending"}</b>
            </span>
          </div>
        </section>
      </div>
      <div className="content-grid">
        <section className="card">
          <div className="section-heading">
            <div>
              <h3>Upcoming itinerary</h3>
              <p>Plan the details together</p>
            </div>
            <Link className="text-btn" to="itinerary">
              View itinerary
            </Link>
          </div>
          <div className="compact-list">
            {itinerary.data?.snapshot.items.slice(0, 3).map((item) => (
              <div key={item.id}>
                <div className="activity-icon">
                  <CalendarDays size={17} />
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{new Date(item.startAt).toLocaleString()}</span>
                </div>
                <Pill tone={item.status === "CONFIRMED" ? "good" : "neutral"}>
                  {item.status}
                </Pill>
              </div>
            ))}
            {!itinerary.data?.snapshot.items.length && (
              <p className="empty-small">
                {itinerary.error ??
                  "Your shared itinerary items will appear here."}
              </p>
            )}
          </div>
        </section>
        <section className="card">
          <div className="section-heading">
            <div>
              <h3>Group readiness</h3>
              <p>Private details are never shared.</p>
            </div>
            <Pill tone="good">
              {readiness.data
                ? `${readiness.data.readyCount}/${readiness.data.memberCount} submitted`
                : "Loading"}
            </Pill>
          </div>
          <div className="member-list">
            {readiness.data?.members.map((m) => (
              <div key={m.userId}>
                <Avatar name={m.displayName} small />
                <div>
                  <strong>{m.displayName}</strong>
                  <span>{m.role === "CREATOR" ? "Organizer" : "Traveler"}</span>
                </div>
                <span className={m.submitted ? "ready" : "q-muted"}>
                  {m.submitted && <CheckCircle2 size={17} />}
                  {m.submitted ? "Ready" : "Waiting"}
                </span>
              </div>
            ))}
          </div>
          {readiness.error && <p role="alert">{readiness.error}</p>}
        </section>
        <section className="card">
          <div className="section-heading">
            <div>
              <h3>Trip at a glance</h3>
              <p>Current group status</p>
            </div>
            <Users size={20} />
          </div>
          <div className="activity-feed">
            <div>
              <i className="feed-green" />
              <p>
                <strong>{trip.members.length} travelers joined</strong>
                <span>{trip.invites.length} invitations pending</span>
              </p>
            </div>
            <div>
              <i className="feed-blue" />
              <p>
                <strong>{trip.status.label}</strong>
                <span>
                  {submitted
                    ? "Your preferences are saved"
                    : "Add your preferences to get started"}
                </span>
              </p>
            </div>
          </div>
          {isCreator && (
            <Link
              className="btn btn-secondary btn-sm"
              to={`/trips/${trip.id}/setup/invite`}
            >
              Invite more people
            </Link>
          )}
        </section>
      </div>
      {isCreator && (
        <DeleteTrip
          tripId={trip.id}
          name={trip.name}
          travelers={trip.members.length}
        />
      )}
    </section>
  );
}

export function MembersPage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const { data, error } = useLoad(
    () => api.readiness(userId, trip.id),
    [userId, trip.id],
    3000,
  );
  return (
    <section>
      <PageTitle
        title="Trip members"
        subtitle={`${trip.members.length} travelers are collaborating on this trip.`}
        action={
          trip.me.role === "CREATOR" && (
            <Link
              className="btn btn-primary btn-md"
              to={`/trips/${trip.id}/setup/invite`}
            >
              Invite member
            </Link>
          )
        }
      />
      <PrivacyBanner />
      {error && (
        <p role="alert" className="q-banner q-banner-error">
          {error}
        </p>
      )}
      <div className="members-grid">
        {data?.members.map((m) => (
          <article className="member-card" key={m.userId}>
            <Avatar name={m.displayName} />
            <div>
              <h3>{m.displayName}</h3>
              <p>{m.role === "CREATOR" ? "Organizer" : "Traveler"}</p>
            </div>
            <Pill tone={m.submitted ? "good" : "neutral"}>
              {m.submitted
                ? "Preferences submitted"
                : "Waiting for preferences"}
            </Pill>
            {m.userId === userId && (
              <Link className="btn btn-secondary btn-sm" to="../preferences">
                View my preferences
              </Link>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

/** Organizer only: two-step delete (button, then an inline confirmation). */
function DeleteTrip({
  tripId,
  name,
  travelers,
}: {
  tripId: string;
  name: string;
  travelers: number;
}) {
  const { userId } = useSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteTrip(userId, tripId);
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the trip");
      setBusy(false);
    }
  }

  return (
    <div className="q-danger">
      {!confirming ? (
        <div className="q-row">
          <div>
            <strong>Delete this trip</strong>
            <p className="q-muted q-small">
              Removes the trip for everyone. Only you, the organizer, can do
              this.
            </p>
          </div>
          <button
            type="button"
            className="q-btn q-btn-danger-outline"
            onClick={() => setConfirming(true)}
          >
            Delete trip
          </button>
        </div>
      ) : (
        <div
          role="alertdialog"
          aria-labelledby="del-title"
          aria-describedby="del-desc"
        >
          <strong id="del-title">Delete “{name}”?</strong>
          <p id="del-desc" className="q-small">
            {travelers === 1
              ? "This removes the trip"
              : `This removes it for all ${travelers} travelers`}
            , along with preferences, the group plan, votes and itinerary. This
            can't be undone.
          </p>
          {error && (
            <p role="alert" className="q-field-error">
              {error}
            </p>
          )}
          <div className="q-actions">
            <button
              type="button"
              className="q-btn"
              onClick={() => setConfirming(false)}
              disabled={busy}
              autoFocus
            >
              Cancel
            </button>
            <button
              type="button"
              className="q-btn q-btn-danger"
              onClick={remove}
              disabled={busy}
            >
              {busy ? "Deleting…" : "Yes, delete trip"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Flights / Stays tabs: SYS-03 (Duffel / Booking.com search) is a later milestone. */
export function ComingSoonPage({ title }: { title: string; system: string }) {
  return (
    <section>
      <PageTitle
        title={title}
        subtitle="Part of the proposed Quorum experience"
      />
      <div className="readiness-card">
        <div className="ai-orb">
          <LockKeyhole size={30} />
        </div>
        <h2>{title} is coming next</h2>
        <p>
          This feature is not implemented in the current group planning
          prototype.
        </p>
        <Link to="../plan" className="btn btn-primary btn-md">
          View group plan
        </Link>
      </div>
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
      .catch((e) =>
        setError(
          e instanceof ApiError ? e.message : "Could not join this trip",
        ),
      );
  }, [userId, code]);

  if (tripId) return <Navigate to={`/trips/${tripId}/preferences`} replace />;
  return (
    <main id="main" className="q-page q-wrap q-narrow">
      {error ? (
        <p role="alert" className="q-banner q-banner-error">
          {error}
        </p>
      ) : (
        <p>Joining trip…</p>
      )}
    </main>
  );
}
