import { useEffect, useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export function LoginPage() {
  // null = still asking the API whether an admin exists yet.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [apiDown, setApiDown] = useState<string | null>(null);
  const { login, refresh } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>("/admin/setup-status")
      .then((r) => setNeedsSetup(r.needsSetup))
      .catch((err) => {
        setApiDown(err instanceof ApiError ? err.message : "Couldn't reach the Master API.");
        setNeedsSetup(false);
      });
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong logging in");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ token: string; admin: unknown }>("/admin/setup", {
        name,
        email,
        password,
        setupKey,
      });
      // /admin/setup issues a session like /admin/login would - store it, then reload the profile.
      setToken(result.token);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNeedsSetup(false);
        setError("Setup has already been completed - log in instead.");
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong setting up");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold text-gray-400">MASTER APP</div>
          <div className="text-xl font-bold text-primary">TechWolf Inventory</div>
        </div>

        {apiDown && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{apiDown}</div>}
        {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {needsSetup === null ? (
          <p className="text-center text-sm text-gray-400">Checking…</p>
        ) : needsSetup ? (
          <form onSubmit={handleSetup} className="space-y-3">
            <h1 className="text-base font-semibold">Create the master admin account</h1>
            <p className="mb-2 text-xs text-gray-500">
              No admin exists yet. This only works once, and needs the
              <code className="mx-1 rounded bg-gray-100 px-1">MASTER_SETUP_KEY</code>
              from <code className="rounded bg-gray-100 px-1">MasterControl/.env</code>.
            </p>
            <input required placeholder="Your name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="email" required placeholder="Email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              type="password"
              required
              minLength={10}
              placeholder="Password (min 10 characters)"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input required placeholder="Setup key" className="input" value={setupKey} onChange={(e) => setSetupKey(e.target.value)} autoComplete="off" />
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "Creating account…" : "Create admin account"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <h1 className="text-base font-semibold">Log in</h1>
            <input type="email" required placeholder="Email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <input
              type="password"
              required
              placeholder="Password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
