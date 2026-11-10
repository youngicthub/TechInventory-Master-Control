import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/status-badge";
import type { InstallationStatus } from "@/lib/api";

interface IncidentRow {
  id: number; title: string; module: string | null; severity: string; status: string; occurrences: number;
  firstSeenAt: string; lastSeenAt: string; assignedAdminName: string | null; lastAppVersion: string | null;
  affectedInstallations: number; affectedCustomers: number;
}
interface Alert { id: string; type: string; severity: "critical" | "warning"; title: string; detail: string; link: string; since: string | null }
interface IncidentDetail extends Omit<IncidentRow, "affectedInstallations" | "affectedCustomers"> {
  resolutionNotes: string | null; assignedAdminId: number | null; allowedTransitions: string[];
  installations: { installationId: number; code: string; device: string | null; customerId: number; customer: string; appVersion: string | null; occurrences: number; lastSeenAt: string; status: InstallationStatus; pending: number | null; failed: number | null }[];
  versions: { version: string; count: number }[];
  events: { id: number; kind: string; adminName: string | null; note: string | null; createdAt: string }[];
  days: { day: string; count: number }[];
}

const SEV: Record<string, string> = {
  critical: "bg-red-100 text-red-800", error: "bg-orange-100 text-orange-800",
  warning: "bg-amber-100 text-amber-800", info: "bg-blue-100 text-blue-800",
};
const STATUS: Record<string, string> = {
  new: "bg-red-50 text-red-700", acknowledged: "bg-blue-50 text-blue-700", investigating: "bg-amber-50 text-amber-700",
  resolved: "bg-green-50 text-green-700", reopened: "bg-red-50 text-red-700",
};
const pill = (cls: string, text: string) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
const when = (iso: string) => new Date(iso).toLocaleString();

export function IncidentsPage() {
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("");
  const [assigned, setAssigned] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) p.set("status", status);
    if (severity) p.set("severity", severity);
    if (assigned) p.set("assigned", assigned);
    if (q.trim()) p.set("q", q.trim());
    api.get<{ rows: IncidentRow[]; total: number }>(`/incidents?${p}`)
      .then((r) => { setRows(r.rows); setTotal(r.total); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load incidents"));
  }, [page, status, severity, assigned, q]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get<{ alerts: Alert[] }>("/alerts").then((r) => setAlerts(r.alerts)).catch(() => setAlerts([])); }, []);
  useEffect(() => { setPage(1); }, [status, severity, assigned, q]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Incidents</h1>
        <p className="text-sm text-gray-500">Repeated errors from installed apps are grouped here so each problem is handled once.</p>
      </div>

      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {alerts.slice(0, 6).map((a) => (
            <button key={a.id} onClick={() => navigate(a.link.replace(/^#?\/?/, "/"))}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${a.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <span className="font-semibold">{a.title}</span> <span className="text-gray-600">{a.detail}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input !w-56" placeholder="Search title or module" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Open (not resolved)</option><option value="">All</option>
          {["new", "acknowledged", "investigating", "reopened", "resolved"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input !w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">Any severity</option>{["critical", "error", "warning", "info"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input !w-auto" value={assigned} onChange={(e) => setAssigned(e.target.value)} aria-label="Assignment">
          <option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>
        </select>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-3">Problem</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Times</th><th className="px-4 py-3">Affected</th><th className="px-4 py-3">Last seen</th><th className="px-4 py-3">Assigned</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td className="px-4 py-6 text-gray-400" colSpan={7}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td className="px-4 py-6 text-gray-400" colSpan={7}>No incidents match. Errors reported by installed apps will appear here.</td></tr>}
            {rows?.map((i) => (
              <tr key={i.id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => navigate(`/incidents/${i.id}`)}>
                <td className="px-4 py-3"><div className="font-medium">{i.title}</div><div className="text-xs text-gray-500">{i.module ?? "—"}{i.lastAppVersion ? ` · v${i.lastAppVersion}` : ""}</div></td>
                <td className="px-4 py-3">{pill(SEV[i.severity] ?? "", i.severity)}</td>
                <td className="px-4 py-3">{pill(STATUS[i.status] ?? "", i.status)}</td>
                <td className="px-4 py-3">{i.occurrences}</td>
                <td className="px-4 py-3 text-xs">{i.affectedInstallations} install(s) · {i.affectedCustomers} customer(s)</td>
                <td className="px-4 py-3 text-xs">{when(i.lastSeenAt)}</td>
                <td className="px-4 py-3 text-xs">{i.assignedAdminName ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{total} incident(s)</span>
        <span className="flex gap-2">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn-secondary" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}

export function IncidentDetailPage({ id }: { id: number }) {
  const { can } = useAuth();
  const canManage = can("incidents.manage");
  const [inc, setInc] = useState<IncidentDetail | null>(null);
  const [admins, setAdmins] = useState<{ id: number; name: string; active: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<IncidentDetail>(`/incidents/${id}`).then((r) => { setInc(r); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this incident"));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canManage) api.get<{ id: number; name: string; active: boolean }[]>("/admins").then(setAdmins).catch(() => setAdmins([])); }, [canManage]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); setError(null); load(); } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work"); } finally { setBusy(false); }
  }
  function transition(to: string) {
    let text: string | undefined;
    if (to === "resolved" || to === "reopened") {
      const asked = window.prompt(to === "resolved" ? "Resolution note (what fixed it?)" : "Why is this being reopened?");
      if (asked === null) return;
      text = asked.trim();
    }
    run(() => api.post(`/incidents/${id}/transition`, { to, note: text }));
  }

  if (!inc) return error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : <p className="text-gray-500">Loading…</p>;
  const maxDay = Math.max(1, ...inc.days.map((d) => d.count));

  return (
    <div className="space-y-4">
      <button className="text-sm text-gray-500 hover:underline" onClick={() => navigate("/incidents")}>← All incidents</button>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{inc.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              {pill(SEV[inc.severity] ?? "", inc.severity)}{pill(STATUS[inc.status] ?? "", inc.status)}
              <span>{inc.occurrences} occurrence(s)</span><span>First {when(inc.firstSeenAt)}</span><span>Last {when(inc.lastSeenAt)}</span>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {inc.allowedTransitions.map((t) => (
                <button key={t} disabled={busy} className={t === "resolved" ? "btn-primary" : "btn-secondary"} onClick={() => transition(t)}>
                  {t === "acknowledged" ? "Acknowledge" : t === "investigating" ? "Start investigating" : t === "resolved" ? "Resolve" : "Reopen"}
                </button>
              ))}
              <select className="input !w-auto" value={inc.assignedAdminId ?? ""} disabled={busy} aria-label="Assign to"
                onChange={(e) => run(() => api.post(`/incidents/${id}/assign`, { adminId: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Unassigned</option>
                {admins.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
        </div>
        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {inc.resolutionNotes && <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"><b>Resolution:</b> {inc.resolutionNotes}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Occurrences per day</h2>
          {inc.days.length === 0 ? <p className="text-sm text-gray-400">No daily history yet.</p> : (
            <div className="flex h-24 items-end gap-1" role="img" aria-label="Occurrences per day">
              {inc.days.slice(-30).map((d) => <div key={d.day} title={`${d.day}: ${d.count}`} className="flex-1 rounded-t bg-red-400" style={{ height: `${Math.max(6, (d.count / maxDay) * 100)}%` }} />)}
            </div>
          )}
          <h2 className="mb-1 mt-4 font-semibold">App versions affected</h2>
          <div className="flex flex-wrap gap-2 text-sm">{inc.versions.map((v) => <span key={v.version} className="rounded bg-gray-100 px-2 py-0.5">v{v.version} × {v.count}</span>)}</div>
        </div>

        <div className="card p-5">
          <h2 className="mb-2 font-semibold">Timeline</h2>
          <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {inc.events.length === 0 && <li className="text-gray-400">Nothing yet.</li>}
            {[...inc.events].reverse().map((e) => (
              <li key={e.id}><span className="font-medium">{e.kind}</span> · {e.adminName ?? "system"} · <span className="text-xs text-gray-500">{when(e.createdAt)}</span>{e.note && <div className="text-gray-600">{e.note}</div>}</li>
            ))}
          </ul>
          {canManage && (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) run(async () => { await api.post(`/incidents/${id}/note`, { note: note.trim() }); setNote(""); }); }}>
              <input className="input" placeholder="Add an internal note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-secondary" disabled={busy || !note.trim()}>Add</button>
            </form>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="px-5 pt-4 font-semibold">Affected installations</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-2">Installation</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Version</th><th className="px-4 py-2">Times</th><th className="px-4 py-2">Last seen</th></tr></thead>
          <tbody>
            {inc.installations.map((n) => (
              <tr key={n.installationId} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => navigate(`/installations/${n.installationId}`)}>
                <td className="px-4 py-2">{n.device ?? n.code}</td><td className="px-4 py-2">{n.customer}</td>
                <td className="px-4 py-2"><StatusBadge status={n.status} /></td><td className="px-4 py-2">{n.appVersion ?? "—"}</td>
                <td className="px-4 py-2">{n.occurrences}</td><td className="px-4 py-2 text-xs">{when(n.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
