import { useEffect, useState } from "react";
import { api, ApiError, type Admin } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Used both as the normal "Change password" page and as the forced first-login gate. */
export function AccountPage({ forced = false }: { forced?: boolean }) {
  const { admin, adoptSession, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      const result = await api.post<{ token: string; admin: Admin }>("/admin/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      adoptSession(result.token, result.admin);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't change the password");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <div className="card w-full max-w-md p-6">
      <h1 className="mb-1 text-lg font-semibold">{forced ? "Choose your own password" : "Change password"}</h1>
      <p className="mb-4 text-sm text-gray-500">
        {forced
          ? `Welcome, ${admin?.name}. You're using a temporary password - set a new one to continue.`
          : "Changing your password signs you out everywhere else."}
      </p>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {done && <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Password changed.</div>}
      <form onSubmit={submit} className="space-y-3">
        <input type="password" required className="input" placeholder={forced ? "Temporary password" : "Current password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <input type="password" required minLength={10} className="input" placeholder="New password (min 10 characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <input type="password" required minLength={10} className="input" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Save password"}
        </button>
        {forced && (
          <button type="button" className="btn-secondary w-full" onClick={logout}>
            Log out
          </button>
        )}
      </form>
    </div>
  );

  if (forced) return <div className="flex min-h-screen items-center justify-center bg-canvas px-4">{form}</div>;
  return (
    <div className="space-y-6">
      {form}
      <SecuritySection onSignOutEverywhere={logout} />
    </div>
  );
}


interface LoginEvent {
  action: string;
  outcome: string;
  description: string;
  ip: string | null;
  createdAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  "admin.login": "Signed in",
  "admin.login_failed": "Failed sign-in attempt",
  "admin.logout": "Signed out everywhere",
  "admin.change_password": "Password changed",
};

function SecuritySection({ onSignOutEverywhere }: { onSignOutEverywhere: () => void }) {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  useEffect(() => {
    api.get<LoginEvent[]>("/admin/login-history").then(setEvents).catch(() => setEvents([]));
  }, []);
  return (
    <div className="card w-full max-w-md p-6">
      <h2 className="mb-1 text-lg font-semibold">Sessions and sign-in history</h2>
      <p className="mb-3 text-sm text-gray-500">Not you? Sign out everywhere ends every session on every device, then change your password.</p>
      <button className="btn-secondary mb-4" onClick={onSignOutEverywhere}>
        Sign out of all devices
      </button>
      <div className="text-sm">
        {!events && <p className="text-gray-400">Loading…</p>}
        {events?.length === 0 && <p className="text-gray-400">No history yet.</p>}
        {events?.map((e, i) => (
          <div key={i} className="flex justify-between border-t border-gray-100 py-1.5">
            <span className={e.outcome === "failure" || e.action === "admin.login_failed" ? "text-red-700" : ""}>{EVENT_LABEL[e.action] ?? e.action}</span>
            <span className="text-xs text-gray-500">
              {new Date(e.createdAt).toLocaleString()}
              {e.ip ? ` · ${e.ip}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
