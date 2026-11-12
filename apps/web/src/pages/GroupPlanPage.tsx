import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { FeasiblePlan, VoteChoice } from "@quorum/shared";
import { ApiError, api, type PlanView, type Readiness } from "../api";
import { Eyebrow, Pill, type TripContext } from "../components/Layout";
import { useLoad, useSession } from "../session";
import { usePlanUpdates, type LiveState } from "../usePlanUpdates";

const fmt = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Workflow 1 · Screens 4–6 on the "Group plan" tab. Which screen shows
 * depends on the plan's state:
 *   no plan / rejected / infeasible -> 4. Ready to generate
 *   PROPOSED                        -> 5. Review and vote
 *   CONFIRMED                       -> 6. Majority approved
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
      setActionError(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const error = readiness.error ?? plan.error;
  if (error) return <p role="alert" className="q-banner q-banner-error">{error}</p>;
  if (!readiness.data || !plan.data) return <p>Loading group plan…</p>;

  const p = plan.data.plan;
  const banner = (
    <>
      <LiveBadge state={live} />
      {actionError && <p role="alert" className="q-banner q-banner-error">{actionError}</p>}
    </>
  );

  if (p?.status === "CONFIRMED" && p.result.feasible) {
    return <Confirmed trip={trip} plan={p} result={p.result} />;
  }
  if (p?.status === "PROPOSED" && p.result.feasible) {
    return (
      <ReviewAndVote
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
      creatorName={trip.members.find((m) => m.role === "CREATOR")?.displayName ?? "the organizer"}
      tripId={trip.id}
      busy={busy}
      banner={banner}
      onGenerate={() => act(() => api.generatePlan(userId, trip.id))}
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

  return (
    <section className="q-content" aria-labelledby="ready-title">
      <Eyebrow>Group plan</Eyebrow>
      <h1 id="ready-title">Ready to find your group's best fit?</h1>
      {props.banner}

      {plan?.status === "INFEASIBLE" && !plan.result.feasible && (
        <div className="q-banner q-banner-warn" role="status">
          <strong>{plan.result.conflict === "dates" ? "Dates conflict" : "Budget conflict"}:</strong> {plan.result.message}
          <br />
          <span>{plan.result.suggestion}</span>
        </div>
      )}
      {plan?.status === "REJECTED" && (
        <div className="q-banner q-banner-warn" role="status">
          The group rejected the last plan ({plan.rejections} of {plan.memberCount} voted no). Update preferences and generate a new one.
        </div>
      )}

      <div className="q-highlight">
        <strong>{r.readyCount} of {r.memberCount} travelers are ready</strong>
      </div>
      <ul className="q-list" aria-label="Travelers">
        {r.members.map((m) => (
          <li key={m.userId} className="q-list-row">
            <span>
              {m.displayName}
              {m.role === "CREATOR" && <span className="q-muted q-small"> · organizer</span>}
            </span>
            {m.submitted ? <Pill tone="good">Submitted</Pill> : <Pill>Waiting</Pill>}
          </li>
        ))}
      </ul>
      <p className="q-muted q-small">
        The planner only sees who has submitted. It never shows anyone's budget or dates to the group.
      </p>

      <div className="q-actions">
        <Link to={`/trips/${props.tripId}/preferences`} className="q-btn">Edit my preferences</Link>
        {r.canGenerate ? (
          <button className="q-btn q-btn-primary" disabled={busy} onClick={props.onGenerate}>
            {busy ? "Generating…" : plan ? "Generate a new plan" : "Generate group plan"}
          </button>
        ) : (
          <span className="q-muted q-small" role="status">
            {r.readyCount < r.minimumToGenerate
              ? `Waiting for at least ${r.minimumToGenerate} travelers to submit.`
              : `Waiting for ${props.creatorName} to generate the plan.`}
          </span>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ 5. Review and vote */

type LivePlan = NonNullable<PlanView["plan"]>;

function PlanFacts({ result }: { result: FeasiblePlan }) {
  return (
    <ul className="q-facts">
      <li className="q-highlight"><strong>Within all budgets</strong></li>
      <li>
        {result.sharedInterests.length} shared interest{result.sharedInterests.length === 1 ? "" : "s"}
        {result.sharedInterests.length > 0 && <span className="q-muted"> · {result.sharedInterests.map(cap).join(", ")}</span>}
      </li>
      <li>{fmt(result.startDate)} – {fmt(result.endDate)} · {result.nights} night{result.nights === 1 ? "" : "s"}</li>
      <li>Up to {usd(result.perPersonCapUsd)} per person <span className="q-muted">(est. flights, stay, food)</span></li>
    </ul>
  );
}

function ReviewAndVote(props: {
  plan: LivePlan;
  result: FeasiblePlan;
  busy: boolean;
  banner: React.ReactNode;
  onVote: (c: VoteChoice) => void;
}) {
  const { plan, result, busy } = props;
  return (
    <section className="q-content" aria-labelledby="match-title">
      <Eyebrow>Top group match · {result.matchScore}% fit</Eyebrow>
      <h1 id="match-title">{result.destination.city}, {result.destination.state}</h1>
      {props.banner}

      <div className="q-split">
        <PlanFacts result={result} />
        <aside className="q-vote-card" aria-live="polite">
          <p className="q-vote-count">{plan.approvals} of {plan.memberCount} approved</p>
          <p className="q-small">{plan.needed} needed to confirm</p>
          <span className="q-pill q-pill-onDark">Voting open</span>
        </aside>
      </div>

      {result.alternatives.length > 0 && (
        <p className="q-muted q-small">
          Also considered: {result.alternatives.map((a) => `${a.city} (${a.matchScore}%)`).join(", ")}
        </p>
      )}

      {plan.myVote && (
        <p className="q-muted" role="status">
          You voted to <strong>{plan.myVote === "APPROVE" ? "accept" : "reject"}</strong> this plan. You can change your vote while voting is open.
        </p>
      )}
      <div className="q-actions">
        <button className="q-btn" disabled={busy || plan.myVote === "REJECT"} onClick={() => props.onVote("REJECT")}>Reject</button>
        <button className="q-btn q-btn-primary" disabled={busy || plan.myVote === "APPROVE"} onClick={() => props.onVote("APPROVE")}>Accept plan</button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------- 6. Majority approved */

function Confirmed({ trip, plan, result }: { trip: TripContext["trip"]; plan: LivePlan; result: FeasiblePlan }) {
  return (
    <section className="q-content" aria-labelledby="confirmed-title">
      <Eyebrow>Group vote</Eyebrow>
      <h1 id="confirmed-title">Your group plan is confirmed</h1>
      <p className="q-lead">{result.destination.city}, {result.destination.state} · {fmt(result.startDate)} – {fmt(result.endDate)}</p>
      <ul className="q-facts">
        <li className="q-highlight"><strong>{plan.approvals} of {plan.memberCount} approved</strong></li>
        <li>Flights and stays unlocked</li>
        <li>No booking or payment occurred</li>
      </ul>
      <div className="q-actions">
        <Link to={`/trips/${trip.id}/itinerary`} className="q-btn">Open itinerary</Link>
        <Link to={`/trips/${trip.id}/flights`} className="q-btn q-btn-primary">Compare flights</Link>
      </div>
    </section>
  );
}
