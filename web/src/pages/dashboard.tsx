import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type DashboardOverview } from "@/lib/api";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/status-badge";

// ---------- small helpers ----------

function readPref(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private window etc. */ }
}
function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const TONE: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700",
  info: "text-blue-700",
};

/** value === undefined means "unavailable" (never shown as 0). */
function Stat({ label, value, tone = "neutral", to, hint, unavailable }: {
  label: string; value?: number | string; tone?: Tone; to?: string; hint?: string; unavailable?: string;
}) {
  const body = (
    <>
      <div className={`text-2xl font-bold leading-tight ${unavailable ? "text-gray-300" : TONE[tone]}`}>
        {unavailable ? "—" : value}
      </div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
      {hint && !unavailable && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
      {unavailable && <div className="mt-0.5 text-[11px] text-gray-400">Unavailable</div>}
    </>
  );
  const cls = "card p-4 text-left";
  if (unavailable) return <div className={cls} title={unavailable}>{body}</div>;
  return to ? (
    <button className={`${cls} w-full transition hover:border-gray-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`} onClick={() => navigate(to)}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

function Panel({ title, empty, children, action }: { title: string; empty?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {empty ? <p className="py-6 text-center text-sm text-gray-400">{empty}</p> : children}
    </div>
  );
}

// ---------- charts (plain SVG, no dependency) ----------

function BarChart({ data, color = "#dc2626", label }: { data: { x: string; y: number }[]; color?: string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const w = 320, h = 110, pad = 18, bw = Math.max(4, (w - pad * 2) / Math.max(1, data.length) - 4);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={label}>
      <line x1={pad} y1={h - 20} x2={w - pad} y2={h - 20} stroke="#e5e7eb" />
      {data.map((d, i) => {
        const bh = Math.round((d.y / max) * (h - 44));
        const x = pad + i * ((w - pad * 2) / data.length) + 2;
        return (
          <g key={d.x}>
            <rect x={x} y={h - 20 - bh} width={bw} height={bh} rx={2} fill={color}><title>{`${d.x}: ${d.y}`}</title></rect>
            {(data.length <= 8 || i % Math.ceil(data.length / 6) === 0) && (
              <text x={x + bw / 2} y={h - 6} textAnchor="middle" fontSize="8" fill="#9ca3af">{d.x.slice(5)}</text>
            )}
          </g>
        );
      })}
      <text x={w - pad} y={10} textAnchor="end" fontSize="9" fill="#9ca3af">max {max}</text>
    </svg>
  );
}

function LineChart({ points, series, label }: {
  points: DashboardOverview["trends"]["connectivity"];
  series: { key: "online" | "offline" | "warning" | "critical"; color: string; name: string }[];
  label: string;
}) {
  const w = 320, h = 120, pad = 22;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key])));
  const t0 = new Date(points[0].t).getTime();
  const t1 = new Date(points[points.length - 1].t).getTime();
  const X = (t: string) => pad + (t1 === t0 ? 0 : ((new Date(t).getTime() - t0) / (t1 - t0)) * (w - pad * 2));
  const Y = (v: number) => h - 20 - (v / max) * (h - 40);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={label}>
        <line x1={pad} y1={h - 20} x2={w - pad} y2={h - 20} stroke="#e5e7eb" />
        {series.map((s) => (
          <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
            points={points.map((p) => `${X(p.t).toFixed(1)},${Y(p[s.key]).toFixed(1)}`).join(" ")} />
        ))}
        <text x={pad} y={h - 6} fontSize="8" fill="#9ca3af">{new Date(points[0].t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text>
        <text x={w - pad} y={h - 6} textAnchor="end" fontSize="8" fill="#9ca3af">{new Date(points[points.length - 1].t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</text>
        <text x={w - pad} y={10} textAnchor="end" fontSize="9" fill="#9ca3af">max {max}</text>
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-gray-500">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
    </div>
  );
}

function fillDays(rows: { day: string; n: number }[], days: number): { x: string; y: number }[] {
  const map = new Map(rows.map((r) => [r.day, r.n]));
  const out: { x: string; y: number }[] = [];
  const span = Math.min(days, 30);
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ x: d, y: map.get(d) ?? 0 });
  }
  return out;
}

// ---------- page ----------

const REFRESH_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "15 s", ms: 15_000 },
  { label: "30 s", ms: 30_000 },
  { label: "1 min", ms: 60_000 },
];

export function DashboardPage() {
  const [days, setDays] = useState(() => Number(readPref("mc.dash.days", "7")) || 7);
  const [refreshMs, setRefreshMs] = useState(() => Number(readPref("mc.dash.refresh", "30000")));
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [, tick] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return; // never run two requests at once
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoading(true);
    try {
      const next = await api.get<DashboardOverview>(`/dashboard/overview?days=${days}`);
      if (!ctrl.signal.aborted) {
        setData(next);
        setError(null);
        setLastOk(Date.now());
      }
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof ApiError ? err.message : "Couldn't reach the Master server");
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
    return () => { inFlight.current?.abort(); inFlight.current = null; };
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => { if (!document.hidden) load(); }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, load]);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const stale = lastOk !== null && (error !== null || (refreshMs > 0 && Date.now() - lastOk > refreshMs * 3));
  const i = data?.installations;
  const c = data?.customers;
  const un = data?.unavailable ?? {};

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Operations</h1>
          <p className="text-sm text-gray-500">
            {lastOk ? <>Updated {ago(new Date(lastOk).toISOString())}</> : "Loading…"}
            {stale && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Data may be stale</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-gray-500">Period
            <select className="input !w-auto !py-1" value={days} onChange={(e) => { const v = Number(e.target.value); setDays(v); writePref("mc.dash.days", String(v)); }}>
              <option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-gray-500">Auto-refresh
            <select className="input !w-auto !py-1" value={refreshMs} onChange={(e) => { const v = Number(e.target.value); setRefreshMs(v); writePref("mc.dash.refresh", String(v)); }}>
              {REFRESH_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
            </select>
          </label>
          <button className="btn-secondary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <span>{error}{data ? " - showing the last data we received." : ""}</span>
          <button className="underline" onClick={load}>Retry</button>
        </div>
      )}

      {!data && loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
          {Array.from({ length: 10 }).map((_, n) => <div key={n} className="card h-20 animate-pulse bg-gray-100" />)}
        </div>
      )}

      {data && c && i && (
        <>
          <Section title="Customers">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Registered" value={c.total} to="/customers" />
              <Stat label="Awaiting approval" value={c.pending} tone={c.pending ? "warn" : "neutral"} to="/signups" />
              <Stat label="Active" value={c.active} tone="good" to="/customers?status=active" />
              <Stat label="Suspended" value={c.suspended} tone={c.suspended ? "bad" : "neutral"} to="/customers?status=suspended" />
              <Stat label={`New (${days === 1 ? "today" : `${days} days`})`} value={c.newInPeriod} tone="info" to="/customers" />
            </div>
          </Section>

          <Section title="Installations">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total" value={i.total} to="/installations" />
              <Stat label="Online" value={i.online} tone="good" to="/installations?filter=online" />
              <Stat label="Offline" value={i.offline} tone={i.offline ? "bad" : "neutral"} to="/installations?filter=offline" />
              <Stat label="Warning" value={i.warning} tone={i.warning ? "warn" : "neutral"} to="/installations?filter=warning" />
              <Stat label="Critical" value={i.critical} tone={i.critical ? "bad" : "neutral"} to="/installations?filter=critical" />
              <Stat label="Need attention" value={i.needAttention} tone={i.needAttention ? "warn" : "neutral"} to="/installations?filter=attention" />
            </div>
            {i.unknown > 0 && <p className="mt-1 text-xs text-gray-400">{i.unknown} activated installation(s) haven't checked in yet.</p>}
          </Section>

          <Section title="Synchronization">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Changes waiting" value={data.sync.pendingChanges} to="/installations?filter=pending" />
              <Stat label="Installations waiting" value={data.sync.installationsPendingSync} tone={data.sync.installationsPendingSync ? "warn" : "neutral"} to="/installations?filter=pending" />
              <Stat label="Failed changes" value={data.sync.failedChanges} tone={data.sync.failedChanges ? "bad" : "neutral"} to="/installations?filter=attention" />
              <Stat label="Conflicts" value={data.sync.conflicts} tone={data.sync.conflicts ? "bad" : "neutral"} to="/installations?filter=attention" />
              <Stat label="Last successful sync" value={ago(data.sync.lastSuccessfulSyncAt)} />
              <Stat label="Sync success rate" unavailable={un.syncSuccessRate} />
            </div>
          </Section>

          <Section title="System health">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Errors today" value={data.errors.today} tone={data.errors.today ? "warn" : "neutral"} to="/installations?filter=attention" />
              <Stat label="Open critical errors" value={data.errors.openCritical} tone={data.errors.openCritical ? "bad" : "neutral"} />
              <Stat label="Repeated error groups" value={data.errors.repeatedGroups} tone={data.errors.repeatedGroups ? "warn" : "neutral"} hint="3+ occurrences, still open" />
              <Stat label="Master database" value={data.health.database === "ok" ? "Healthy" : "Problem"} tone={data.health.database === "ok" ? "good" : "bad"} hint={`${data.health.databaseLatencyMs} ms`} />
              <Stat label="Up to date" value={data.releases.installationsTotal ? `${data.releases.installationsOnLatest}/${data.releases.installationsTotal}` : "—"} hint={data.releases.latest.map((r) => `${r.platform} ${r.version}`).join(" · ") || "No release published"} to="/releases" />
              <Stat label="Backups" unavailable={un.backups} />
            </div>
          </Section>

          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            <Panel title="Connectivity over time" empty={data.trends.connectivity.length < 2 ? "Collecting data - a reading is taken every 5 minutes while the Master runs." : undefined}>
              {data.trends.connectivity.length >= 2 && (
                <LineChart label="Installation connectivity" points={data.trends.connectivity}
                  series={[{ key: "online", color: "#059669", name: "Online" }, { key: "offline", color: "#dc2626", name: "Offline" }, { key: "warning", color: "#d97706", name: "Warning" }]} />
              )}
            </Panel>
            <Panel title="Sign-ups per day">
              <BarChart label="Customer registrations per day" data={fillDays(data.trends.registrations, days)} color="#2563eb" />
            </Panel>
            <Panel title="New errors per day">
              <BarChart label="New errors per day" data={fillDays(data.trends.errors, days)} color="#d97706" />
            </Panel>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Needs attention" empty={data.attention.length === 0 ? "Nothing needs attention right now." : undefined}>
              <ul className="divide-y divide-gray-100">
                {data.attention.map((a) => (
                  <li key={a.id}>
                    <button className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-gray-50" onClick={() => navigate(`/installations/${a.id}`)}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.customer} · {a.device || a.code}</span>
                        <span className="block truncate text-xs text-gray-500">{a.reasons.join(" · ")}</span>
                      </span>
                      <StatusBadge status={a.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Software versions" empty={i.total === 0 ? "No installations yet." : undefined}>
              <ul className="space-y-2">
                {i.versions.map((v) => (
                  <li key={v.version}>
                    <button className="w-full text-left" onClick={() => navigate(`/installations?version=${encodeURIComponent(v.version)}`)}>
                      <div className="flex justify-between text-sm"><span>{v.version}</span><span className="text-gray-500">{v.count}</span></div>
                      <div className="mt-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-primary" style={{ width: `${(v.count / i.total) * 100}%` }} /></div>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Recent registrations" empty={data.recent.customers.length === 0 ? "No customers yet." : undefined} action={<button className="text-xs text-primary underline" onClick={() => navigate("/customers")}>All</button>}>
              <ul className="divide-y divide-gray-100">
                {data.recent.customers.map((r) => (
                  <li key={r.id}><button className="flex w-full justify-between py-2 text-left text-sm hover:bg-gray-50" onClick={() => navigate(`/customers/${r.id}`)}><span className="truncate">{r.name}</span><span className="ml-2 shrink-0 text-xs text-gray-500">{r.status} · {ago(r.createdAt)}</span></button></li>
                ))}
              </ul>
            </Panel>
            <Panel title="Recent installation activity" empty={data.recent.activity.length === 0 ? "No installation has checked in yet." : undefined}>
              <ul className="divide-y divide-gray-100">
                {data.recent.activity.map((a) => (
                  <li key={a.id}><button className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-gray-50" onClick={() => navigate(`/installations/${a.id}`)}><span className="truncate">{a.customer} · {a.device || a.code}</span><span className="ml-2 flex shrink-0 items-center gap-2 text-xs text-gray-500">{ago(a.lastSeenAt)}<StatusBadge status={a.status} /></span></button></li>
                ))}
              </ul>
            </Panel>
            <Panel title="Recent critical errors" empty={data.recent.criticalErrors.length === 0 ? "No critical errors recorded." : undefined}>
              <ul className="divide-y divide-gray-100">
                {data.recent.criticalErrors.map((e) => (
                  <li key={e.id}><button className="block w-full py-2 text-left hover:bg-gray-50" onClick={() => navigate(`/installations/${e.installationId}`)}><span className="block truncate text-sm">{e.message}</span><span className="text-xs text-gray-500">{e.module ?? "app"} · ×{e.occurrences} · {e.status} · {ago(e.lastSeenAt)}</span></button></li>
                ))}
              </ul>
            </Panel>
          </div>

          <p className="mt-6 text-xs text-gray-400">
            Offline = no heartbeat for more than {"the configured threshold (MASTER_OFFLINE_THRESHOLD_SECONDS)"}. Greyed "Unavailable" figures aren't reported by the apps yet - hover for why. Connectivity history starts when the Master began recording; nothing is back-filled.
          </p>
        </>
      )}
    </div>
  );
}
