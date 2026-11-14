import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  Avatar,
  date,
  DestinationImage,
  money,
  PageTitle,
  PrivacyBanner,
} from "../components/Design";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { FeasiblePlan, PlanStatus, VoteChoice } from "@quorum/shared";
import { ApiError, api, type PlanView, type Readiness } from "../api";
import { Pill, type TripContext } from "../components/Layout";
import { useLoad, useSession } from "../session";
import { usePlanUpdates, type LiveState } from "../usePlanUpdates";

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Workflow 1 · Screens 4–6 on the "Group plan" tab. Which screen shows
 * depends on the plan's state:
 *   no plan / rejected / infeasible -> 4. Ready to generate
 *   PROPOSED                        -> 5. Review and vote
 *   CONFIRMED                       -> 6. Majority approved
 * FR-204: if anyone changed their preferences after the plan was generated,
 * every screen shows an "outdated" notice and voting is paused until the
 * organizer regenerates.
 */
export function GroupPlanPage() {
  const { trip, reloadTrip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const readiness = useLoad(() => api.readiness(userId, trip.id), [userId, trip.id]);
  const plan = useLoad(() => api.plan(userId, trip.id), [userId, trip.id]);
  // Other members' submissions and votes arrive over Socket.IO (plan:changed), not polling.
  const live = usePlanUpdates(userId, trip.id, () => {
    readiness.reload();
    plan.reload();
    reloadTrip();
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(fn: () => Promise<PlanView>) {
    setBusy(true);
    setActionError(null);
    try {
      plan.setData(await fn());
      readiness.reload();
      reloadTrip();
    } catch (e) {
      setActionError(
        e instanceof ApiError ? e.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  const error = readiness.error ?? plan.error;
  if (error)
    return (
      <p role="alert" className="q-banner q-banner-error">
        {error}
      </p>
    );
  if (!readiness.data || !plan.data) return <p>Loading group plan…</p>;

  const p = plan.data.plan;
  const creatorName =
    trip.members.find((m) => m.role === "CREATOR")?.displayName ??
    "the organizer";
  const onGenerate = () => act(() => api.generatePlan(userId, trip.id));
  // Screens 5 and 6 have no generate button of their own, so the notice carries one.
  const hasOwnGenerate = !(p?.status === "PROPOSED" || p?.status === "CONFIRMED") || !p.result.feasible;
  const notice = p?.outdated && (
    <OutdatedNotice
      status={p.status}
      canRegenerate={readiness.data.canGenerate && !hasOwnGenerate}
      isOrganizer={trip.me.role === "CREATOR"}
      creatorName={creatorName}
      busy={busy}
      onRegenerate={onGenerate}
    />
  );
  const banner = (
    <>
      <LiveBadge state={live} />
      {actionError && <p role="alert" className="q-banner q-banner-error">{actionError}</p>}
      {notice}
    </>
  );

  if (p?.status === "CONFIRMED" && p.result.feasible) {
    return <Confirmed trip={trip} plan={p} result={p.result} banner={notice} />;
  }
  if (p?.status === "PROPOSED" && p.result.feasible) {
    return (
      <ReviewAndVote
        trip={trip}
        plan={p}
        result={p.result}
        busy={busy}
        banner={banner}
        onVote={(choice) => act(() => api.vote(userId, trip.id, choice))}
      />
    );
  }
  return (
    <ReadyToGenerate
      readiness={readiness.data}
      plan={p}
      creatorName={creatorName}
      tripId={trip.id}
      busy={busy}
      banner={banner}
      onGenerate={onGenerate}
    />
  );
}

/** Same look as the itinerary's sync badge, so members can tell updates are live. */
function LiveBadge({ state }: { state: LiveState }) {
  const text = { connecting: "Connecting…", live: "Live updates on", offline: "Offline – reconnecting" }[state];
  return (
    <p className={`sync sync-${state}`} role="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </p>
  );
}

/** FR-204: the plan was solved from preferences that have since changed. */
function OutdatedNotice(props: {
  status: PlanStatus;
  canRegenerate: boolean;
  isOrganizer: boolean;
  creatorName: string;
  busy: boolean;
  onRegenerate: () => void;
}) {
  const consequence =
    props.status === "PROPOSED"
      ? "Voting is paused until a new plan is generated."
      : props.status === "CONFIRMED"
        ? "It stays confirmed until a new plan is generated."
        : "A new plan may now work for everyone.";
  const next = props.isOrganizer
    ? "Generate a new plan to include the latest preferences."
    : `Waiting for ${props.creatorName} to generate a new plan.`;
  return (
    <div className="alert alert-warning outdated-notice" role="status">
      <RefreshCw size={17} />
      <div>
        <strong>This plan is out of date</strong>
        <p>
          A traveler updated their preferences after this plan was generated.{" "}
          {consequence} {next}
        </p>
        {props.canRegenerate && (
          <button
            className="btn btn-primary btn-sm"
            disabled={props.busy}
            onClick={props.onRegenerate}
          >
            <RefreshCw size={15} />
            {props.busy ? "Regenerating…" : "Regenerate plan"}
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------- 4. Ready to generate */

function ReadyToGenerate(props: {
  readiness: Readiness;
  plan: PlanView["plan"];
  creatorName: string;
  tripId: string;
  busy: boolean;
  banner: React.ReactNode;
  onGenerate: () => void;
}) {
  const { readiness: r, plan, busy } = props;
  const conflict =
    plan?.status === "INFEASIBLE" && !plan.result.feasible ? plan.result : null;
  return (
    <section>
      <PageTitle
        eyebrow="GROUP PLAN"
        title={
          conflict
            ? "Let’s find a plan that works"
            : "Ready to find your group’s best fit?"
        }
        subtitle="A plan built from your group’s private preferences."
      />
      {props.banner}
      {conflict ? (
        <>
          <div className="conflict-card">
            <div className="conflict-visual">
              <div>
                <CalendarDays size={28} />
              </div>
              <span />
              <div>
                <TriangleAlert size={28} />
              </div>
            </div>
            <Pill tone="warn">No feasible match yet</Pill>
            <h2>
              {conflict.conflict === "dates"
                ? "No trip currently fits everyone’s availability."
                : "No trip currently fits everyone’s budget."}
            </h2>
            <p>{conflict.message}</p>
            <div className="conflict-detail">
              <TriangleAlert size={20} />
              <div>
                <strong>A small change may solve it</strong>
                <p>{conflict.suggestion}</p>
              </div>
            </div>
            <div className="conflict-actions">
              <Link
                className="btn btn-primary btn-md"
                to={`/trips/${props.tripId}/preferences`}
              >
                Revise my preferences
              </Link>
              {r.canGenerate && (
                <button
                  className="btn btn-secondary btn-md"
                  disabled={busy}
                  onClick={props.onGenerate}
                >
                  {busy ? "Generating…" : "Try again"}
                </button>
              )}
            </div>
          </div>
          <PrivacyBanner />
        </>
      ) : (
        <div className="readiness-card">
          <div className="ai-orb">
            <Sparkles size={30} />
          </div>
          <h2>
            {r.readyCount} of {r.memberCount} travelers are ready
          </h2>
          <p>
            Quorum compares dates, budgets, departure airports, and shared
            interests without revealing individual constraints.
          </p>
          {plan?.status === "REJECTED" && (
            <div className="alert alert-warning" role="status">
              The group rejected the last plan ({plan.rejections} of{" "}
              {plan.memberCount} voted no). Update preferences and generate a
              new one.
            </div>
          )}
          <div className="readiness-list">
            {r.members.map((m) => (
              <div key={m.userId}>
                <Avatar name={m.displayName} small />
                <strong>{m.displayName}</strong>
                <span className={m.submitted ? "ready" : "q-muted"}>
                  {m.submitted && <CheckCircle2 size={17} />}
                  {m.submitted ? "Submitted" : "Waiting"}
                </span>
              </div>
            ))}
          </div>
          {r.canGenerate ? (
            <button
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={props.onGenerate}
            >
              <Sparkles size={17} />
              {busy
                ? "Generating your plan…"
                : plan
                  ? "Generate a new plan"
                  : "Generate group plan"}
            </button>
          ) : (
            <p role="status">
              {r.readyCount < r.minimumToGenerate
                ? `Waiting for at least ${r.minimumToGenerate} travelers to submit.`
                : `Waiting for ${props.creatorName} to generate the plan.`}
            </p>
          )}
          <small>
            Estimates use the prototype solver, not live availability or prices.
          </small>
          <Link
            className="btn btn-ghost btn-sm"
            to={`/trips/${props.tripId}/preferences`}
          >
            Edit my preferences
          </Link>
        </div>
      )}
    </section>
  );
}

type LivePlan = NonNullable<PlanView["plan"]>;
function PlanScreen({
  trip,
  plan,
  result,
  busy = false,
  banner,
  onVote,
}: {
  trip: TripContext["trip"];
  plan: LivePlan;
  result: FeasiblePlan;
  busy?: boolean;
  banner?: React.ReactNode;
  onVote?: (choice: VoteChoice) => void;
}) {
  const confirmed = plan.status === "CONFIRMED";
  return (
    <section>
      <PageTitle
        eyebrow="GROUP PLAN"
        title={
          confirmed
            ? "Your group plan is confirmed"
            : "A plan built for the whole group"
        }
        subtitle="Based on everyone’s private preferences and current demo estimates."
        action={
          <Pill tone={confirmed ? "good" : plan.outdated ? "warn" : "info"}>
            {confirmed
              ? "Majority approved"
              : plan.outdated
                ? "Voting paused"
                : "Voting open"}
          </Pill>
        }
      />
      {banner}
      <div className="plan-hero">
        <DestinationImage name={result.destination.city} />
        <div>
          <Pill tone="teal">TOP GROUP MATCH · {result.matchScore}% FIT</Pill>
          <h2>
            {result.destination.city}, {result.destination.state}
          </h2>
          <p>
            <CalendarDays size={17} />
            {date(result.startDate)} – {date(result.endDate)} ·{" "}
            {plan.memberCount} travelers
          </p>
          <div className="plan-price">
            <span>Estimated budget cap</span>
            <strong>{money(result.perPersonCapUsd)}</strong>
            <small>per person</small>
          </div>
        </div>
      </div>
      <div className="plan-layout">
        <div>
          <section className="card why-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WHY THIS WORKS</p>
                <h3>A strong fit across the group</h3>
              </div>
              <Sparkles size={24} />
            </div>
            <p>
              These dates fall within the group’s shared availability. The
              estimated trip cost fits every submitted budget, with interests
              balanced across the group.
            </p>
            <div className="match-pills">
              <Pill tone="teal">
                <Check size={14} />
                Shared dates
              </Pill>
              <Pill tone="teal">
                <Check size={14} />
                Within all budgets
              </Pill>
              <Pill tone="teal">
                <Check size={14} />
                {result.sharedInterests.length} shared interests
              </Pill>
            </div>
          </section>
          <section className="card">
            <div className="section-heading">
              <div>
                <h3>Group cost estimate</h3>
                <p>Travel, lodging, food and activities</p>
              </div>
              <Pill>Demo estimates</Pill>
            </div>
            <div className="cost-list">
              <span>
                Trip length <b>{result.nights} nights</b>
              </span>
              <span>
                Shared interests{" "}
                <b>
                  {result.sharedInterests.map(cap).join(", ") ||
                    "No shared tags"}
                </b>
              </span>
              <span>
                Estimated range per person{" "}
                <b>
                  {money(result.perPersonLowUsd)} –{" "}
                  {money(result.perPersonCapUsd)}
                </b>
              </span>
              <strong>
                Estimated maximum per traveler{" "}
                <b>{money(result.perPersonCapUsd)}</b>
              </strong>
            </div>
            <p className="estimate-note">
              Distance-based estimates, not live quotes. Individual budgets and
              dates remain private.
            </p>
          </section>
          {result.alternatives.length > 0 && (
            <p className="q-muted q-small">
              Also considered:{" "}
              {result.alternatives
                .map((a) => `${a.city} (${a.matchScore}%)`)
                .join(", ")}
            </p>
          )}
          {confirmed && (
            <div className="privacy-banner">
              <CheckCircle2 size={21} />
              <div>
                <strong>Majority reached</strong>
                <p>
                  No booking or payment occurred. Flights and stays are planned
                  for a later milestone.
                </p>
              </div>
            </div>
          )}
        </div>
        <aside className="vote-card" aria-live="polite">
          <p className="eyebrow">GROUP VOTE</p>
          <h3>
            {confirmed
              ? "The plan is approved!"
              : "Does this plan work for you?"}
          </h3>
          <div className="vote-ring">
            <strong>{plan.approvals}</strong>
            <span>
              of {plan.memberCount}
              <br />
              approved
            </span>
          </div>
          <div className="vote-bar">
            <i
              style={{ width: `${(plan.approvals / plan.memberCount) * 100}%` }}
            />
          </div>
          <p>
            {confirmed
              ? "Majority reached. Keep planning together."
              : `${plan.needed} approvals needed for a majority.`}
          </p>
          <div className="voter-list">
            <span>
              <i className="accept" />
              {plan.approvals} accepted
            </span>
            <span>
              <i className="reject" />
              {plan.rejections} rejected
            </span>
            <span>
              <i />
              {plan.memberCount - plan.approvals - plan.rejections} pending
            </span>
          </div>
          {confirmed ? (
            <Link
              className="btn btn-primary btn-md"
              to={`/trips/${trip.id}/itinerary`}
            >
              Open itinerary
              <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <div className="vote-actions">
                <button
                  className="btn btn-primary btn-md"
                  disabled={busy || plan.outdated || plan.myVote === "APPROVE"}
                  onClick={() => onVote?.("APPROVE")}
                >
                  <Check size={17} />
                  Accept plan
                </button>
                <button
                  className="btn btn-secondary btn-md"
                  disabled={busy || plan.outdated || plan.myVote === "REJECT"}
                  onClick={() => onVote?.("REJECT")}
                >
                  <X size={17} />
                  Reject
                </button>
              </div>
              {plan.myVote && !plan.outdated && (
                <p role="status">
                  You voted to {plan.myVote === "APPROVE" ? "accept" : "reject"}
                  . You can change your vote while voting is open.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
function ReviewAndVote(props: {
  trip: TripContext["trip"];
  plan: LivePlan;
  result: FeasiblePlan;
  busy: boolean;
  banner: React.ReactNode;
  onVote: (choice: VoteChoice) => void;
}) {
  return <PlanScreen {...props} />;
}
function Confirmed(props: {
  trip: TripContext["trip"];
  plan: LivePlan;
  result: FeasiblePlan;
  banner?: React.ReactNode;
}) {
  return <PlanScreen {...props} />;
}
