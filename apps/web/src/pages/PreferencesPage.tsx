import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { AIRPORTS, PREFERENCE_TAGS, preferenceInputSchema, type PreferenceTag } from "@quorum/shared";
import { ApiError, api } from "../api";
import { CheckCircle2, Sparkles } from "lucide-react";
import { PageTitle, PrivacyBanner } from "../components/Design";
import { type TripContext } from "../components/Layout";
import { useSession } from "../session";

interface Range {
  start: string;
  end: string;
}

/**
 * Workflow 1 · Screen 3 — "My travel preferences" (FR-101, FR-102, FR-103).
 * Validated with the same zod schema the server uses, so errors show
 * instantly; the server still re-checks every submission.
 */
export function PreferencesPage() {
  const { trip } = useOutletContext<TripContext>();
  const { userId } = useSession();
  const navigate = useNavigate();

  const [ranges, setRanges] = useState<Range[]>([{ start: "", end: "" }]);
  const [budget, setBudget] = useState("");
  const [airport, setAirport] = useState("");
  const [tags, setTags] = useState<PreferenceTag[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoaded(false);
    let alive = true;
    api.myPreference(userId, trip.id).then(({ preference: p }) => {
      if (!alive) return;
      if (p) {
        setRanges(p.dateRanges);
        setBudget(String(p.maxBudgetUsd));
        setAirport(p.departureAirport);
        setTags(p.tags);
      } else {
        setRanges([{ start: "", end: "" }]);
        setBudget("");
        setAirport("");
        setTags([]);
      }
      setLoaded(true);
    }).catch(() => { if (alive) { setFormError("Could not load your preferences. Please try again."); setLoaded(true); } });
    return () => { alive = false; };
  }, [userId, trip.id]);

  /** Editing a field clears its error until the next submit. */
  const clear = (...keys: string[]) =>
    setErrors((e) => (keys.some((k) => k in e) ? Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))) : e));
  const setRange = (i: number, patch: Partial<Range>) => {
    clear(...Object.keys(patch).map((k) => `dateRanges.${i}.${k}`), "dateRanges");
    setRanges(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const toggleTag = (t: PreferenceTag) =>
    setTags(tags.includes(t) ? tags.filter((x) => x !== t) : tags.length < 5 ? [...tags, t] : tags);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = {
      dateRanges: ranges,
      maxBudgetUsd: budget.trim() === "" ? Number.NaN : Number(budget),
      departureAirport: airport,
      tags,
    };
    const local = preferenceInputSchema.safeParse(input);
    if (!local.success) {
      const f: Record<string, string> = {};
      for (const i of local.error.issues) f[i.path.join(".")] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.savePreference(userId, trip.id, input);
      navigate(`/trips/${trip.id}/plan`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setFormError(err.message);
      } else setFormError("Could not save your preferences");
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const describe = (key: string) => (errors[key] ? `err-${key.replace(/\./g, "-")}` : undefined);
  const ErrorText = ({ k }: { k: string }) =>
    errors[k] ? <span id={`err-${k.replace(/\./g, "-")}`} className="q-field-error">{errors[k]}</span> : null;

  if (!loaded) return <p>Loading your preferences…</p>;

  return (
    <section className="preferences-page"><PageTitle title="My travel preferences" subtitle="Only you can see your exact dates and budget." /><PrivacyBanner /><div className="preferences-layout"><form className="card pref-form" onSubmit={submit} noValidate aria-labelledby="pref-title">
      {formError && <p role="alert" className="q-banner q-banner-error">{formError}</p>}

      <fieldset className="q-fieldset pref-section">
        <legend><span className="section-number">1</span> Available dates</legend><p className="section-description">Add one or more windows when you can travel.</p>
        {ranges.map((r, i) => (
          <div key={i} className="q-date-row">
            <label className="q-field">
              From
              <input type="date" value={r.start} onChange={(e) => setRange(i, { start: e.target.value })}
                aria-invalid={!!err(`dateRanges.${i}.start`)} aria-describedby={describe(`dateRanges.${i}.start`)} />
              <ErrorText k={`dateRanges.${i}.start`} />
            </label>
            <label className="q-field">
              To
              <input type="date" value={r.end} min={r.start || undefined} onChange={(e) => setRange(i, { end: e.target.value })}
                aria-invalid={!!err(`dateRanges.${i}.end`)} aria-describedby={describe(`dateRanges.${i}.end`)} />
              <ErrorText k={`dateRanges.${i}.end`} />
            </label>
            {ranges.length > 1 && (
              <button type="button" className="q-btn q-btn-ghost" onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
                aria-label={`Remove date range ${i + 1}`}>Remove</button>
            )}
          </div>
        ))}
        <ErrorText k="dateRanges" />
        {ranges.length < 5 && (
          <button type="button" className="q-btn q-btn-ghost" onClick={() => setRanges([...ranges, { start: "", end: "" }])}>
            + Add another date range
          </button>
        )}
      </fieldset>

      <div className="pref-section"><div className="form-section-title"><span>2</span><div><h3>Maximum budget</h3><p>Your total personal budget, including travel, stay, food, and activities.</p></div></div>
        <label className="q-field">
          Maximum budget (USD)
          <div className="q-input-prefix">
            <span aria-hidden="true">$</span>
            <input inputMode="numeric" value={budget} onChange={(e) => (clear("maxBudgetUsd"), setBudget(e.target.value))} placeholder="1500"
              aria-invalid={!!err("maxBudgetUsd")} aria-describedby={describe("maxBudgetUsd") ?? "budget-help"} />
          </div>
          {err("maxBudgetUsd") ? <ErrorText k="maxBudgetUsd" /> : <span id="budget-help" className="q-muted q-small">Flights, lodging, food and activities, per person.</span>}
        </label>
      </div><div className="pref-section"><div className="form-section-title"><span>3</span><div><h3>Departure airport</h3><p>We’ll compare travel from your preferred airport.</p></div></div>
        <label className="q-field">
          Airport
          <input aria-label="Departure airport" list="airports" value={airport} onChange={(e) => (clear("departureAirport"), setAirport(e.target.value.toUpperCase()))} placeholder="IND" maxLength={3}
            aria-invalid={!!err("departureAirport")} aria-describedby={describe("departureAirport")} />
          <datalist id="airports">
            {AIRPORTS.map((a) => <option key={a.code} value={a.code}>{a.city}, {a.state}</option>)}
          </datalist>
          <ErrorText k="departureAirport" />
        </label>
      </div>

      <fieldset className="q-fieldset pref-section">
        <legend><span className="section-number">4</span> Travel preferences</legend><p className="section-description">Choose up to five things you’d enjoy most.</p>
        <div className="q-chips">
          {PREFERENCE_TAGS.map((t) => (
            <button key={t} type="button" className={`q-chip${tags.includes(t) ? " on" : ""}`} aria-pressed={tags.includes(t)} onClick={() => toggleTag(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <ErrorText k="tags" />
      </fieldset>

      <div className="q-actions">
        <Link to={`/trips/${trip.id}`} className="q-btn">Cancel</Link>
        <button className="q-btn q-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save preferences"}</button>
      </div>
    </form><aside className="pref-side card"><div className="side-icon"><Sparkles size={20} /></div><h3>How Quorum uses this</h3><p>We combine everyone’s constraints without showing private values to other travelers.</p>{["Find overlapping dates", "Stay within every budget", "Balance group interests"].map(text => <div key={text}><CheckCircle2 size={17} /><span>{text}</span></div>)}</aside></div></section>
  );
}
