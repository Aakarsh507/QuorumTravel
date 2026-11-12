import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type DevUser } from "./api";

/**
 * DEV-ONLY stand-in for login (SYS-07). Holds "who am I" for every page and
 * lets the demo switch between group members. Replace with a real session
 * once authentication lands; pages only read `userId` from here.
 */
interface Session {
  userId: string;
  user: DevUser | undefined;
  users: DevUser[];
  setUserId: (id: string) => void;
  error: string | null;
}

const SessionContext = createContext<Session | null>(null);
const KEY = "quorum.devUserId";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<DevUser[]>([]);
  const [userId, setUserIdState] = useState<string>(() => localStorage.getItem(KEY) ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .devUsers()
      .then((list) => {
        setUsers(list);
        setUserIdState((current) => {
          if (list.some((u) => u.id === current)) return current;
          // default to the Workflow 1 demo creator when present
          return (list.find((u) => u.displayName.startsWith("Alex")) ?? list[0])?.id ?? "";
        });
      })
      .catch(() => setError("Cannot reach the server on port 3001. Start it with: npm run dev:server"));
  }, []);

  const setUserId = (id: string) => {
    localStorage.setItem(KEY, id);
    setUserIdState(id);
  };

  return (
    <SessionContext.Provider value={{ userId, user: users.find((u) => u.id === userId), users, setUserId, error }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

/** Small data hook: runs `load` when deps change, optional polling for live views. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = () =>
      load()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    void run();
    const t = pollMs ? setInterval(run, pollMs) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, setData, reload: () => setTick((n) => n + 1) };
}
