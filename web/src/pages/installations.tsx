import { useEffect, useState } from "react";
import { api, ApiError, type Installation } from "@/lib/api";
import { navigate, useQueryParams } from "@/lib/router";
import { StatusBadge } from "@/components/status-badge";

export function InstallationsPage() {
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQueryParams();
  const filter = query.get("filter") ?? "all";
  const versionFilter = query.get("version") ?? "";
  const [search, setSearch] = useState("");

  const FILTERS: { key: string; label: string; test: (i: Installation) => boolean }[] = [
    { key: "all", label: "All", test: () => true },
    { key: "online", label: "Online", test: (i) => i.status === "online" },
    { key: "offline", label: "Offline", test: (i) => i.status === "offline" },
    { key: "warning", label: "Warning", test: (i) => i.status === "warning" },
    { key: "critical", label: "Critical", test: (i) => i.status === "critical" },
    { key: "attention", label: "Needs attention", test: (i) => ["critical", "warning"].includes(i.status) || (i.failedCount ?? 0) > 0 || (i.conflictCount ?? 0) > 0 },
    { key: "pending", label: "Waiting to sync", test: (i) => (i.pendingCount ?? 0) > 0 },
  ];
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const term = search.trim().toLowerCase();
  const visible = installations?.filter(
    (i) =>
      activeFilter.test(i) &&
      (!versionFilter || (i.appVersion ?? "unknown") === versionFilter) &&
      (!term || `${i.customerName} ${i.deviceName ?? ""} ${i.installationCode}`.toLowerCase().includes(term)),
  );

  useEffect(() => {
    // Live view: refreshes every 10 seconds so you can watch tills come online and sync.
    const load = () =>
      api
        .get<Installation[]>("/installations")
        .then((rows) => {
          setInstallations(rows);
          setError(null);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load installations"));
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Installations</h1>
      <p className="mb-6 text-sm text-gray-500">Live - updates every 10 seconds.</p>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => navigate(`/installations${f.key === "all" ? "" : `?filter=${f.key}`}${versionFilter ? `${f.key === "all" ? "?" : "&"}version=${encodeURIComponent(versionFilter)}` : ""}`)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${activeFilter.key === f.key ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            {f.label}
          </button>
        ))}
        {versionFilter && (
          <button onClick={() => navigate(`/installations${filter === "all" ? "" : `?filter=${filter}`}`)} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
            Version {versionFilter} ✕
          </button>
        )}
        <input className="input ml-auto max-w-xs" placeholder="Search customer or device…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Waiting to sync</th>
              <th className="px-4 py-3">Last synced</th>
              <th className="px-4 py-3">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {visible?.map((i) => (
              <tr
                key={i.id}
                className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                onClick={() => navigate(`/installations/${i.id}`)}
              >
                <td className="px-4 py-3 font-medium">{i.customerName}</td>
                <td className="px-4 py-3 text-gray-600">{i.deviceName || i.installationCode}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={i.status} />
                </td>
                <td className="px-4 py-3 text-gray-600">{i.appVersion || "—"}</td>
                <td className="px-4 py-3 text-gray-600">{i.productCount ?? "—"}</td>
                <td className="px-4 py-3">
                  {i.pendingCount == null ? (
                    <span className="text-gray-400">—</span>
                  ) : i.pendingCount === 0 ? (
                    <span className="text-emerald-700">All synced</span>
                  ) : (
                    <span className="font-medium text-amber-700">{i.pendingCount} waiting</span>
                  )}
                  {(i.conflictCount ?? 0) + (i.failedCount ?? 0) > 0 && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                      {(i.conflictCount ?? 0) + (i.failedCount ?? 0)} need attention
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-3 text-gray-600">
                  {i.lastSeenAt ? new Date(i.lastSeenAt).toLocaleString() : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {installations && installations.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">No installations activated yet.</p>
        )}
        {installations && installations.length > 0 && visible?.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">No installations match this filter.</p>
        )}
        {!installations && !error && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>
    </div>
  );
}
