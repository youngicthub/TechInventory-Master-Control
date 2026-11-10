import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type AuditLogEntry } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const AREAS = [
  { label: "Everything", value: "" }, { label: "Logins & admins", value: "admin." }, { label: "Customers", value: "customer." },
  { label: "Installations", value: "installation." }, { label: "Incidents", value: "incident." }, { label: "Releases", value: "release." },
  { label: "Settings", value: "settings." }, { label: "Audit exports", value: "audit." },
];

export function AuditLogsPage() {
  const { can } = useAuth();
  const [data, setData] = useState<{ rows: AuditLogEntry[]; total: number } | null>(null);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 50;

  const query = useCallback(() => {
    const p = new URLSearchParams();
    if (action) p.set("action", action);
    if (outcome) p.set("outcome", outcome);
    if (search.trim()) p.set("search", search.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [action, outcome, search, from, to]);

  useEffect(() => { setPage(1); }, [action, outcome, search, from, to]);
  useEffect(() => {
    const p = query(); p.set("page", String(page)); p.set("pageSize", String(pageSize));
    api.get<{ rows: AuditLogEntry[]; total: number }>(`/audit-logs?${p}`)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the audit log"));
  }, [query, page]);

  async function exportCsv() {
    try { await downloadFile(`/audit-logs/export?${query()}`, "audit-log.csv"); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Couldn't export"); }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="text-sm text-gray-500">An append-only record of administrative and security events.</p>
        </div>
        {can("audit.export") && <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input !w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Area">{AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
        <select className="input !w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome"><option value="">Any outcome</option><option value="success">Success</option><option value="failure">Failure</option></select>
        <input className="input !w-56" placeholder="Search text, reason, email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Details</th><th className="px-4 py-3">Result</th></tr></thead>
          <tbody>
            {!data && <tr><td className="px-4 py-6 text-gray-400" colSpan={5}>Loading…</td></tr>}
            {data?.rows.length === 0 && <tr><td className="px-4 py-6 text-gray-400" colSpan={5}>No entries match these filters.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2">{r.adminName ?? r.actorEmail ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2">{r.description}{r.reason && <div className="text-xs text-gray-500">Reason: {r.reason}</div>}</td>
                <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ${r.outcome === "failure" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{r.outcome ?? "success"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
        <span>{data?.total ?? 0} entries</span>
        <span className="flex gap-2">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn-secondary" disabled={page * pageSize >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}
