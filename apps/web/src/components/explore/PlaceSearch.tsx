import { useEffect, useRef, useState, type FormEvent } from "react";
import { searchPlaces, type ExplorePlace } from "../../services/googleMaps";

interface Props {
  destination: string;
  selected: ExplorePlace | null;
  onSelect: (place: ExplorePlace | null) => void;
}
export function PlaceSearch({ destination, selected, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [results, setResults] = useState<ExplorePlace[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current += 1; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) {
      setMessage("Enter a place, landmark, or category.");
      return;
    }
    const id = ++requestId.current;
    const near = (area ?? destination).trim();
    const text = near ? `${query.trim()} in ${near}` : query.trim();
    setStatus("loading");
    setMessage("");
    setResults([]);
    onSelect(null);
    try {
      const places = await searchPlaces(text);
      if (id !== requestId.current) return;
      setResults(places);
      setStatus("ready");
    } catch {
      if (id !== requestId.current) return;
      setStatus("error");
    }
  }

  return <section className="explore-search" aria-label="Find places">
    <h2>Find a place</h2>
    <form onSubmit={submit}>
      <label className="q-field" htmlFor="place-query">Place or category
        <input id="place-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Museums, restaurants, or a landmark" />
      </label>
      <label className="q-field" htmlFor="place-area">Search near (optional)
        <input id="place-area" value={area ?? destination} onChange={(e) => setArea(e.target.value)} placeholder="City or region" />
      </label>
      <div className="explore-categories" aria-label="Suggested categories">
        {["Restaurants", "Museums", "Parks", "Landmarks"].map((category) =>
          <button key={category} type="button" className="q-chip" disabled={status === "loading"} onClick={() => { setQuery(category); setMessage(""); }}>
            {category}
          </button>)}
      </div>
      <p className="q-muted q-small">Search uses your query followed by “in” and the area above. Clear the area to search elsewhere, for example “Eiffel Tower in Paris”.</p>
      <button className="btn btn-primary btn-md" disabled={status === "loading"} type="submit">{status === "loading" ? "Searching…" : "Search"}</button>
    </form>
    {message && <p role="alert">{message}</p>}
    <div aria-live="polite" aria-busy={status === "loading"}>
      {status === "idle" && <p className="q-muted">Enter a search to discover places. Choose a result to focus the map.</p>}
      {status === "loading" && <p role="status">Searching Google Places…</p>}
      {status === "ready" && !results.length && <p>No places matched. Try a different category or add a city.</p>}
      {status === "error" && <p role="alert" className="q-banner q-banner-error">Google Places could not complete the search. Check your connection and API configuration, then press Search to retry.</p>}
      {!!results.length && <>
        <p>{results.length} places found. Select one to view it on the map.</p>
        <ul className="explore-results">{results.map((place) => <li key={place.placeId}>
          <button type="button" aria-pressed={selected?.placeId === place.placeId} onClick={() => onSelect({ ...place })}>
            <strong>{place.name}</strong><span>{place.address}</span>
            {selected?.placeId === place.placeId && <small>Selected on map</small>}
          </button>
        </li>)}</ul>
      </>}
    </div>
  </section>;
}
