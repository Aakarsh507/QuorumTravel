import { useEffect, useMemo, useState } from "react";
import { ITEM_TYPES, type ItemType, type ItineraryItem } from "@quorum/shared";
import { ApiError, api, type DevUser, type Me, type Member } from "./api";
import { useItinerary, type SyncState } from "./useItinerary";

const TYPE_LABEL: Record<ItemType, string> = { FLIGHT: "Flight", LODGING: "Lodging", ACTIVITY: "Activity" };
const TYPE_ICON: Record<ItemType, string> = { FLIGHT: "✈️", LODGING: "🏨", ACTIVITY: "🎟️" };

const fmtDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz }).format(new Date(iso));
const dayKey = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso)); // YYYY-MM-DD
const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(new Date(iso));
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function App() {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .devUsers()
      .then((u) => {
        setUsers(u);
        if (u[0]) setUserId(u[0].id);
      })
      .catch(() => setLoadError("Cannot reach the server on port 3001. Start it with: npm run dev:server"));
  }, []);

  const user = users.find((u) => u.id === userId);
  const trip = user?.trips[0];

  return (
    <>
      <a className="skip" href="#main">Skip to itinerary</a>
      <header className="topbar">
        <h1>Quorum</h1>
        <div className="who">
          {/* Dev-only stand-in for login (SYS-07) so several members can be demoed */}
          <label htmlFor="user-switch">Viewing as</label>
          <select id="user-switch" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
        </div>
      </header>
      <main id="main">
        {loadError && <p role="alert" className="banner error">{loadError}</p>}
        {user && trip && <ItineraryPage key={`${user.id}:${trip.id}`} userId={user.id} tripId={trip.id} tripName={trip.name} />}
      </main>
    </>
  );
}

function SyncBadge({ sync }: { sync: SyncState }) {
  const text = { connecting: "Connecting…", live: "Live", offline: "Offline – reconnecting", mismatch: "Re-syncing…" }[sync];
  return <span className={`sync sync-${sync}`} role="status"><span className="dot" aria-hidden="true" />{text}</span>;
}

function ItineraryPage({ userId, tripId, tripName }: { userId: string; tripId: string; tripName: string }) {
  const { snapshot, me, members, sync, error, reload } = useItinerary(userId, tripId);
  const [editing, setEditing] = useState<ItineraryItem | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const days = useMemo(() => {
    const map = new Map<string, { label: string; items: ItineraryItem[] }>();
    for (const it of snapshot?.items ?? []) {
      const k = dayKey(it.startAt, it.timezone);
      if (!map.has(k)) map.set(k, { label: fmtDay(it.startAt, it.timezone), items: [] });
      map.get(k)!.items.push(it);
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  }, [snapshot]);

  if (error) return <p role="alert" className="banner error">{error}</p>;
  if (!snapshot || !me) return <p>Loading itinerary…</p>;

  const conflicts = new Set(snapshot.conflictIds);
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName ?? "Unknown";

  async function run(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Something went wrong");
      void reload();
    }
  }

  return (
    <div className="layout">
      <section aria-labelledby="trip-title" className="timeline">
        <div className="trip-head">
          <div>
            <h2 id="trip-title">{tripName}</h2>
            <p className="muted">
              You are {me.role === "CREATOR" ? "the trip creator" : me.canEdit ? "a member with edit rights" : "a member (you can propose items)"}
            </p>
          </div>
          <div className="trip-actions">
            <SyncBadge sync={sync} />
            <button className="primary" onClick={() => setEditing("new")}>
              {me.canManage ? "Add item" : "Propose item"}
            </button>
          </div>
        </div>

        {actionError && <p role="alert" className="banner error">{actionError}</p>}
        {conflicts.size > 0 && (
          <p role="status" className="banner warn">⚠️ {conflicts.size} items overlap in time — look for the red “Conflict” badges.</p>
        )}

        {editing && (
          <ItemForm
            key={editing === "new" ? "new" : editing.id}
            item={editing === "new" ? null : editing}
            members={members}
            me={me}
            onCancel={() => setEditing(null)}
            onSubmit={async (data) => {
              await run(async () => {
                if (editing === "new") await api.create(userId, tripId, data);
                else await api.patch(userId, tripId, editing.id, { expectedVersion: editing.version, ...data });
                setEditing(null);
              });
            }}
          />
        )}

        {days.length === 0 && <p className="muted">Nothing on the itinerary yet.</p>}
        {days.map((day) => (
          <div key={day.label} className="day">
            <h3>{day.label}</h3>
            <ul>
              {day.items.map((it) => {
                const proposed = it.status === "PROPOSED";
                const conflict = conflicts.has(it.id);
                const own = it.createdById === userId;
                const canEditThis = me.canManage || (own && proposed);
                return (
                  <li key={it.id} className={`card type-${it.type.toLowerCase()}${proposed ? " proposed" : ""}${conflict ? " conflict" : ""}`}>
                    <div className="card-main">
                      <span className="icon" aria-hidden="true">{TYPE_ICON[it.type]}</span>
                      <div>
                        <div className="title-row">
                          <strong>{it.title}</strong>
                          <span className="tag">{TYPE_LABEL[it.type]}</span>
                          {proposed && <span className="tag tag-proposed">Proposed</span>}
                          {conflict && <span className="tag tag-conflict">⚠ Conflict</span>}
                        </div>
                        <div className="when">
                          {fmtTime(it.startAt, it.timezone)} → {fmtTime(it.endAt, it.timezone)}
                          {it.location && <> · {it.location}</>}
                        </div>
                        <div className="muted small">
                          For: {it.participantIds.length === 0 ? "everyone" : it.participantIds.map(nameOf).join(", ")} · last edited by {it.lastEditedByName}
                        </div>
                      </div>
                    </div>
                    <div className="card-actions">
                      {proposed && me.canManage && (
                        <>
                          <button onClick={() => run(() => api.patch(userId, tripId, it.id, { expectedVersion: it.version, status: "CONFIRMED" }))}>Confirm</button>
                          <button onClick={() => run(() => api.remove(userId, tripId, it.id))}>Reject</button>
                        </>
                      )}
                      {canEditThis && <button onClick={() => setEditing(it)} aria-label={`Edit ${it.title}`}>Edit</button>}
                      {canEditThis && !(proposed && me.canManage) && (
                        <button onClick={() => run(() => api.remove(userId, tripId, it.id))} aria-label={`${proposed ? "Withdraw" : "Delete"} ${it.title}`}>
                          {proposed ? "Withdraw" : "Delete"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <MembersPanel
        members={members}
        me={me}
        onToggle={(m) => run(() => api.setCanEdit(userId, tripId, m.userId, !m.canEdit))}
      />
    </div>
  );
}

function MembersPanel({ members, me, onToggle }: { members: Member[]; me: Me; onToggle: (m: Member) => void }) {
  return (
    <aside aria-labelledby="members-title" className="members">
      <h2 id="members-title">Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.userId}>
            <span>
              {m.displayName}
              <span className="muted small"> {m.role === "CREATOR" ? "· creator" : m.canEdit ? "· can edit" : "· can propose"}</span>
            </span>
            {me.role === "CREATOR" && m.role !== "CREATOR" && (
              <button onClick={() => onToggle(m)} aria-label={`${m.canEdit ? "Revoke" : "Grant"} edit rights for ${m.displayName}`}>
                {m.canEdit ? "Revoke edit" : "Allow edit"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {me.role !== "CREATOR" && <p className="muted small">Only the trip creator can change who may edit.</p>}
    </aside>
  );
}

interface FormData {
  type: ItemType;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  location: string;
  participantIds: string[];
}

function ItemForm({
  item,
  members,
  me,
  onCancel,
  onSubmit,
}: {
  item: ItineraryItem | null;
  members: Member[];
  me: Me;
  onCancel: () => void;
  onSubmit: (d: FormData) => Promise<void>;
}) {
  const [type, setType] = useState<ItemType>(item?.type ?? "ACTIVITY");
  const [title, setTitle] = useState(item?.title ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [start, setStart] = useState(item ? toLocalInput(item.startAt) : "");
  const [end, setEnd] = useState(item ? toLocalInput(item.endAt) : "");
  const [who, setWho] = useState<string[]>(item?.participantIds ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Title is required";
    if (!start) errs.start = "Start is required";
    if (!end) errs.end = "End is required";
    if (start && end && new Date(end) <= new Date(start)) errs.end = "End must be after start";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    await onSubmit({
      type,
      title: title.trim(),
      location: location.trim(),
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participantIds: who,
    });
  }

  const heading = item ? "Edit item" : me.canManage ? "Add item" : "Propose an item";
  return (
    <form className="form" onSubmit={submit} noValidate aria-labelledby="form-title">
      <h3 id="form-title">{heading}</h3>
      {!me.canManage && !item && <p className="muted small">Your suggestion will appear in a lighter shade until the trip creator confirms it.</p>}
      <div className="grid">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} aria-describedby={errors.title ? "err-title" : undefined} />
          {errors.title && <span id="err-title" className="field-error">{errors.title}</span>}
        </label>
        <label>
          Starts
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!errors.start} />
          {errors.start && <span className="field-error">{errors.start}</span>}
        </label>
        <label>
          Ends
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={!!errors.end} aria-describedby={errors.end ? "err-end" : undefined} />
          {errors.end && <span id="err-end" className="field-error">{errors.end}</span>}
        </label>
        <label className="wide">
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend>Who is this for? (none selected = everyone)</legend>
        {members.map((m) => (
          <label key={m.userId} className="check">
            <input type="checkbox" checked={who.includes(m.userId)} onChange={(e) => setWho(e.target.checked ? [...who, m.userId] : who.filter((x) => x !== m.userId))} />
            {m.displayName}
          </label>
        ))}
      </fieldset>
      <p className="muted small">Times are entered in your local time zone.</p>
      <div className="form-actions">
        <button type="submit" className="primary">{item ? "Save changes" : me.canManage ? "Add to itinerary" : "Submit proposal"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
