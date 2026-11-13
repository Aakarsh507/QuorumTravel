import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, type PlanView } from "../api";
import { PageTitle } from "../components/Design";
import type { TripContext } from "../components/Layout";
import { GoogleMap } from "../components/explore/GoogleMap";
import { PlaceSearch } from "../components/explore/PlaceSearch";
import { useSession } from "../session";
import { loadGoogleMaps, withTimeout, type ExplorePlace } from "../services/googleMaps";

const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();

export function ExplorePage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  // Reset search and selection when the trip or viewing user changes.
  return <ExploreTrip key={`${trip.id}:${userId}`} tripId={trip.id} userId={userId} />;
}

function ExploreTrip({ tripId, userId }: { tripId: string; userId: string }) {
  const [status, setStatus] = useState<"missing" | "loading" | "ready" | "error">(apiKey ? "loading" : "missing");
  const [attempt, setAttempt] = useState(0);
  const [configurationError, setConfigurationError] = useState(false);
  const [selected, setSelected] = useState<ExplorePlace | null>(null);
  const [plan, setPlan] = useState<PlanView["plan"]>(null);
  const [planStatus, setPlanStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    withTimeout(api.plan(userId, tripId)).then((view) => {
      if (active) { setPlan(view.plan); setPlanStatus("ready"); }
    }).catch(() => { if (active) setPlanStatus("error"); });
    return () => { active = false; };
  }, [userId, tripId]);

  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    let authenticationFailed = false;
    const mapsWindow = window as Window & { gm_authFailure?: () => void };
    const previousAuthFailure = mapsWindow.gm_authFailure;
    const authFailure = () => {
      authenticationFailed = true;
      if (active) { setConfigurationError(true); setStatus("error"); }
      previousAuthFailure?.();
    };
    mapsWindow.gm_authFailure = authFailure;
    setStatus("loading");
    loadGoogleMaps(apiKey).then(() => { if (active && !authenticationFailed) setStatus("ready"); })
      .catch(() => { if (active) setStatus("error"); });
    return () => {
      active = false;
      if (mapsWindow.gm_authFailure === authFailure) {
        mapsWindow.gm_authFailure = previousAuthFailure;
      }
    };
  }, [attempt]);

  const handleMapError = useCallback(() => setStatus("error"), []);

  const destination = plan?.result.feasible && (plan.status === "PROPOSED" || plan.status === "CONFIRMED")
    ? `${plan.result.destination.city}, ${plan.result.destination.state}` : "";

  return <section className="explore-page">
    <PageTitle eyebrow="DISCOVER PLACES" title="Explore" subtitle="Find places and choose a result to see it on the map." />
    {status === "missing" && <div className="q-panel">
      <h2>Connect Google Maps</h2>
      <p>Add your browser Maps key to <code>apps/web/.env.local</code>, then restart the web app.</p>
      <pre>VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key</pre>
      <p>Enable Maps JavaScript API and Places API (New). See the README for local setup.</p>
    </div>}
    {status === "loading" && <p role="status">Loading the map and Google Places…</p>}
    {status === "error" && <div className="q-banner q-banner-error" role="alert">
      <p>Google Maps could not load. Check your connection, key, billing, enabled APIs, and localhost restrictions.</p>
      {configurationError ? <>
        <p>Update apps/web/.env.local and restart the web app if the key changed. Reload after correcting API access, billing, or website restrictions.</p>
        <button className="btn btn-secondary btn-md" onClick={() => window.location.reload()}>Reload after fixing configuration</button>
      </> : <button className="btn btn-secondary btn-md" onClick={() => setAttempt((n) => n + 1)}>Retry loading Maps</button>}
    </div>}
    {status === "ready" && <>
      <p className="q-muted" role="status">{planStatus === "loading" ? "Checking the trip destination…" : planStatus === "error"
        ? "The trip destination could not be loaded. You can still enter a search area below."
        : destination ? `${plan?.status === "PROPOSED" ? "Proposed" : "Confirmed"} destination: ${destination}. You can change the search area.`
        : "This trip has no destination yet. Enter a city below or include one in your query."}</p>
      <div className="explore-workspace">
        <PlaceSearch destination={destination} selected={selected} onSelect={setSelected} />
        <section className="explore-map-panel" aria-label="Place map">
          <GoogleMap selectedPlace={selected} onError={handleMapError} />
          <p role="status">{selected ? `${selected.name} — ${selected.address}` : "Select a search result to focus the map."}</p>
        </section>
      </div>
    </>}
  </section>;
}
