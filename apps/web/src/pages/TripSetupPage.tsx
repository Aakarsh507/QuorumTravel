import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { useLoad, useSession } from "../session";

const STEPS = ["Trip details", "Invite members", "Review & create"] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="q-stepper" aria-label="Create trip progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i === current ? "active" : i < current ? "done" : undefined} aria-current={i === current ? "step" : undefined}>
          <span className="q-step-num">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

/** Workflow 1 · Screen 2, step 1 — name the trip (creates it, so it gets an invite link). */
export function NewTripPage() {
  const { userId } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the trip a name");
    setBusy(true);
    try {
      const trip = await api.createTrip(userId, name.trim());
      navigate(`/trips/${trip.id}/setup/invite`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the trip");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="q-page q-wrap q-narrow">
      <form className="q-panel" onSubmit={submit} noValidate>
        <Stepper current={0} />
        <h1>Where's the group headed?</h1>
        <p className="q-muted">Give the trip a name. You can let the group pick the destination later.</p>
        <label className="q-field">
          Trip name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Miami Spring Break 2027"
            aria-invalid={!!error}
            aria-describedby={error ? "name-err" : undefined}
            autoFocus
          />
          {error && <span id="name-err" className="q-field-error">{error}</span>}
        </label>
        <div className="q-actions">
          <Link to="/" className="q-btn">Cancel</Link>
          <button className="q-btn q-btn-primary" disabled={busy}>Continue</button>
        </div>
      </form>
    </main>
  );
}

/** Workflow 1 · Screen 2 — "Who's coming?" (invite link + emails) and the review step. */
export function TripSetupPage() {
  const { tripId = "", step = "invite" } = useParams();
  const { userId } = useSession();
  const navigate = useNavigate();
  const { data: trip, error, setData } = useLoad(() => api.trip(userId, tripId), [userId, tripId]);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (error) return <main className="q-page q-wrap"><p role="alert" className="q-banner q-banner-error">{error}</p></main>;
  if (!trip) return <main className="q-page q-wrap"><p>Loading…</p></main>;

  const link = `${window.location.origin}/join/${trip.inviteCode}`;
  const shortLink = `quorum.app/join/${trip.inviteCode.slice(0, 10)}`;

  async function addEmails(e: React.FormEvent) {
    e.preventDefault();
    const emails = email.split(/[\s,;]+/).filter(Boolean);
    if (emails.length === 0) return setEmailError("Enter at least one email address");
    try {
      const invites = await api.invite(userId, tripId, emails);
      setData({ ...trip!, invites });
      setEmail("");
      setEmailError(null);
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Could not send invites");
    }
  }

  async function copy() {
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === "review") {
    return (
      <main id="main" className="q-page q-wrap q-narrow">
        <div className="q-panel">
          <Stepper current={2} />
          <h1>Ready to start planning?</h1>
          <dl className="q-review">
            <dt>Trip</dt>
            <dd>{trip.name}</dd>
            <dt>Organizer</dt>
            <dd>{trip.members.find((m) => m.role === "CREATOR")?.displayName}</dd>
            <dt>Joined</dt>
            <dd>{trip.members.length} traveler{trip.members.length === 1 ? "" : "s"}</dd>
            <dt>Invited</dt>
            <dd>{trip.invites.length ? trip.invites.map((i) => i.email).join(", ") : "Nobody yet — share the link any time"}</dd>
          </dl>
          <p className="q-muted q-small">Next, add your own travel preferences. Everyone's budget and dates stay private.</p>
          <div className="q-actions">
            <Link to={`/trips/${tripId}/setup/invite`} className="q-btn">Back</Link>
            <button className="q-btn q-btn-primary" onClick={() => navigate(`/trips/${tripId}/preferences`)}>Create trip</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="q-page q-wrap q-narrow">
      <div className="q-panel">
        <Stepper current={1} />
        <h1>Who's coming?</h1>
        <div className="q-highlight q-row">
          <span className="q-mono" title={link}>{shortLink}</span>
          <button type="button" className="q-btn q-btn-primary q-btn-sm" onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
        </div>

        <form onSubmit={addEmails} noValidate>
          <label className="q-field">
            Member email addresses
            <div className="q-row">
              <input
                type="text"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@example.com"
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "email-err" : "email-help"}
              />
              <button className="q-btn">Add</button>
            </div>
            {emailError ? (
              <span id="email-err" className="q-field-error">{emailError}</span>
            ) : (
              <span id="email-help" className="q-muted q-small">Separate several addresses with commas.</span>
            )}
          </label>
        </form>

        {trip.invites.length > 0 && (
          <ul className="q-list" aria-label="Invited">
            {trip.invites.map((i) => (
              <li key={i.email} className="q-list-row">
                {i.email}
                <span className="q-pill q-pill-amber">Invited</span>
              </li>
            ))}
          </ul>
        )}

        <div className="q-actions">
          <Link to="/" className="q-btn">Save and exit</Link>
          <Link to={`/trips/${tripId}/setup/review`} className="q-btn q-btn-primary">Continue</Link>
        </div>
      </div>
    </main>
  );
}
