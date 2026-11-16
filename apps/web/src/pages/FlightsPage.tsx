import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ExternalLink, LockKeyhole, Plane } from "lucide-react";
import type { FlightOffer, FlightSearchResult, FlightSlice } from "@quorum/shared";
import { ApiError, api } from "../api";
import { PageTitle, date, money } from "../components/Design";
import { Pill, type TripContext } from "../components/Layout";
import { useSession } from "../session";

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: FlightSearchResult }
  | { kind: "error"; status: number; message: string };

/** Tab "Flights" (SYS-03, FR-301 / FR-303): the signed-in member's own flight options. */
export function FlightsPage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    api
      .myFlights(userId, trip.id)
      .then((data) => alive && setState({ kind: "ready", data }))
      .catch((e) =>
        alive &&
        setState({
          kind: "error",
          status: e instanceof ApiError ? e.status : 0,
          message: e instanceof ApiError ? e.message : "Could not reach the server",
        }),
      );
    return () => {
      alive = false;
    };
  }, [userId, trip.id, attempt]);

  return (
    <section className="flights-page">
      <PageTitle title="Flights" subtitle="Round trips from your airport on the group's confirmed dates" />
      {state.kind === "loading" && (
        <p className="q-muted" role="status">
          Searching flights… this can take up to 20 seconds.
        </p>
      )}
      {state.kind === "error" && <FlightsUnavailable {...state} retry={() => setAttempt((n) => n + 1)} />}
      {state.kind === "ready" && <FlightResults data={state.data} />}
    </section>
  );
}

function FlightsUnavailable({ status, message, retry }: { status: number; message: string; retry: () => void }) {
  const needsPrefs = status === 409 && /preferences/i.test(message);
  const needsPlan = status === 409 && !needsPrefs;
  return (
    <div className="readiness-card">
      <div className="ai-orb">
        <Plane size={30} />
      </div>
      <h2>{needsPlan ? "Flights open after the plan is confirmed" : needsPrefs ? "Add your preferences first" : "Flight search is unavailable"}</h2>
      <p>{message}</p>
      {needsPlan && (
        <Link to="../plan" className="btn btn-primary btn-md">
          View group plan
        </Link>
      )}
      {needsPrefs && (
        <Link to="../preferences" className="btn btn-primary btn-md">
          Add my preferences
        </Link>
      )}
      {!needsPlan && !needsPrefs && (
        <button type="button" className="btn btn-primary btn-md" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

function FlightResults({ data }: { data: FlightSearchResult }) {
  return (
    <>
      <div className="flight-summary card">
        <div>
          <strong className="flight-route">
            {data.origin} <Plane size={16} aria-hidden /> {data.destination}
          </strong>
          <p className="q-muted">
            {date(data.departDate)} – {date(data.returnDate)} · round trip · 1 adult
          </p>
        </div>
        <div className="flight-cap">
          <LockKeyhole size={16} aria-hidden />
          <div>
            <strong>Your flight budget: {money(data.capUsd)}</strong>
            <p>Private to you: your trip budget minus estimated lodging and daily costs.</p>
          </div>
        </div>
        {data.simulated && (
          <Pill tone="warn">
            {data.source === "sample"
              ? "Sample data: prices and schedules are simulated"
              : "Duffel test mode: prices and schedules are simulated"}
          </Pill>
        )}
      </div>

      {data.offers.length === 0 ? (
        <div className="readiness-card">
          <h2>{data.origin === data.destination ? "No flight needed" : "No flights within your budget"}</h2>
          <p>
            {data.origin === data.destination
              ? "You already live at the destination."
              : "No round trips on these dates came in at or under your flight budget. You can raise your budget in My preferences."}
          </p>
        </div>
      ) : (
        <>
          <ol className="flight-list" aria-label={`${data.offers.length} cheapest flights within your budget`}>
            {data.offers.map((o) => (
              <FlightCard key={o.id} offer={o} />
            ))}
          </ol>
          <p className="q-muted q-small flight-note">
            Times are local to each airport. Flight length includes any layovers.
          </p>
        </>
      )}
    </>
  );
}

const time = (isoLocal: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`${isoLocal}Z`));
const stops = (n: number) => (n === 0 ? "Nonstop" : `${n} stop${n > 1 ? "s" : ""}`);
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

function SliceRow({ label, s }: { label: string; s: FlightSlice }) {
  return (
    <div className="flight-slice">
      <span className="q-muted">{label}</span>
      <span>
        {s.from} {time(s.departAt)} → {s.to} {time(s.arriveAt)}
      </span>
      <span className="q-muted">
        {s.durationMinutes !== null && <strong className="flight-duration">{duration(s.durationMinutes)}</strong>}
        {s.durationMinutes !== null && " · "}
        {stops(s.stops)}
      </span>
    </div>
  );
}

function FlightCard({ offer }: { offer: FlightOffer }) {
  return (
    <li className="flight-card card">
      <div className="flight-airline">
        <strong>{offer.airline.name}</strong>
        <span className="q-muted">{offer.airline.code}</span>
      </div>
      <div className="flight-slices">
        <SliceRow label="Out" s={offer.outbound} />
        <SliceRow label="Back" s={offer.inbound} />
      </div>
      <div className="flight-buy">
        <strong className="flight-price">{money(offer.priceUsd)}</strong>
        <a className="btn btn-primary btn-sm" href={offer.bookingUrl} target="_blank" rel="noopener noreferrer">
          Book on Google Flights <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    </li>
  );
}
