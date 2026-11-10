import { useEffect, useState } from "react";
import { api, ApiError, type Installation, type InstallationCommand, type InstallationError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/status-badge";

type InstallationDetail = Installation & { customerName: string; revokedAt?: string | null; revokedReason?: string | null };

const COMMAND_LABEL = { sync: "Sync now", diagnostics: "Diagnostics" } as const;
const COMMAND_STATE: Record<string, string> = {
  queued: "Waiting for the app to check in",
  delivered: "Sent - waiting for the app to finish",
  completed: "Done",
  failed: "Failed",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-100 text-blue-800",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900",
};

export function InstallationDetailPage({ id }: { id: number }) {
  const [installation, setInstallation] = useState<InstallationDetail | null>(null);
  const [errors, setErrors] = useState<InstallationError[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = useAuth();
  const [commands, setCommands] = useState<InstallationCommand[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCommands = () => api.get<InstallationCommand[]>(`/installations/${id}/commands`).then(setCommands).catch(() => undefined);

  async function request(type: "sync" | "diagnostics") {
    setActionError(null);
    setNotice(null);
    try {
      const r = await api.post<{ note: string }>(`/installations/${id}/commands`, { type });
      setNotice(r.note);
      loadCommands();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't work");
    }
  }

  async function setDisabled(disable: boolean) {
    const reason = window.prompt(disable ? "Disable this device? It will be refused by the Master until re-enabled.\n\nReason (recorded in the audit log):" : "Re-enable this device?\n\nReason:");
    if (reason === null) return;
    setActionError(null);
    try {
      await api.post(`/installations/${id}/${disable ? "revoke" : "restore"}`, { reason });
      const fresh = await api.get<InstallationDetail>(`/installations/${id}`);
      setInstallation(fresh);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "That didn't work");
    }
  }

  useEffect(() => {
    loadCommands();
    const commandTimer = setInterval(loadCommands, 10_000);
    return () => clearInterval(commandTimer);
  }, [id]);

  useEffect(() => {
    const load = () =>
      api
        .get<InstallationDetail>(`/installations/${id}`)
        .then(setInstallation)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this installation"));
    load();
    const timer = setInterval(load, 10_000);
    api
      .get<InstallationError[]>(`/installations/${id}/errors`)
      .then(setErrors)
      .catch(() => setErrors([]));
    return () => clearInterval(timer);
  }, [id]);

  if (error && !installation) {
    return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  }
  if (!installation) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <button onClick={() => navigate("/installations")} className="mb-4 text-sm text-gray-500 hover:text-gray-800">
        ← Back to installations
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{installation.deviceName || installation.installationCode}</h1>
          <p className="text-gray-500">{installation.customerName}</p>
        </div>
        <StatusBadge status={installation.status} />
      </div>

      <div className="card mb-6 p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Installation code</dt>
            <dd className="font-mono">{installation.installationCode}</dd>
          </div>
          <div>
            <dt className="text-gray-500">App version</dt>
            <dd>{installation.appVersion || "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">OS</dt>
            <dd>{installation.osVersion || "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Products on this till</dt>
            <dd className="font-semibold">{installation.productCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Customers on this till</dt>
            <dd>{installation.customerCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Waiting to sync</dt>
            <dd className={installation.pendingCount ? "font-semibold text-amber-700" : "text-emerald-700"}>
              {installation.pendingCount == null ? "—" : installation.pendingCount === 0 ? "Nothing - all synced" : `${installation.pendingCount} change(s) saved offline`}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Needs attention</dt>
            <dd>{(installation.conflictCount ?? 0) + (installation.failedCount ?? 0) || "None"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last synced</dt>
            <dd>{installation.lastSyncAt ? new Date(installation.lastSyncAt).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last seen</dt>
            <dd>{installation.lastSeenAt ? new Date(installation.lastSeenAt).toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Activated</dt>
            <dd>{new Date(installation.createdAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>

      {installation.revokedAt && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          This device is disabled{installation.revokedReason ? ` - ${installation.revokedReason}` : ""}. The Master refuses all its requests.
        </div>
      )}
      {notice && <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{notice}</div>}
      {actionError && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}

      <div className="mb-6 flex flex-wrap gap-2">
        {can("installations.sync") && !installation.revokedAt && (
          <button className="btn-secondary" onClick={() => request("sync")}>
            Request sync
          </button>
        )}
        {can("installations.diagnostics") && !installation.revokedAt && (
          <button className="btn-secondary" onClick={() => request("diagnostics")}>
            Request diagnostics
          </button>
        )}
        {can("installations.revoke") && (
          <button className="btn-secondary" onClick={() => setDisabled(!installation.revokedAt)}>
            {installation.revokedAt ? "Re-enable device" : "Disable device"}
          </button>
        )}
      </div>

      {commands.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-semibold">Remote requests</h2>
          <div className="card mb-6 overflow-hidden text-sm">
            {commands.map((c) => (
              <div key={c.id} className="border-t border-gray-100 px-4 py-2 first:border-t-0">
                <div className="flex justify-between">
                  <span className="font-medium">{COMMAND_LABEL[c.type]}</span>
                  <span className={c.status === "completed" ? "text-green-700" : c.status === "failed" ? "text-red-700" : "text-gray-600"}>{COMMAND_STATE[c.status]}</span>
                </div>
                <div className="text-xs text-gray-400">{new Date(c.requestedAt).toLocaleString()}</div>
                {c.result && <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">{c.result}</pre>}
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-3 text-lg font-semibold">Reported errors</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Module</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Occurrences</th>
              <th className="px-4 py-3">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {errors?.map((e) => (
              <tr key={e.id} className="border-t border-gray-100">
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[e.severity]}`}>
                    {e.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{e.module || "—"}</td>
                <td className="px-4 py-3">{e.message}</td>
                <td className="px-4 py-3 text-gray-600">{e.occurrences}</td>
                <td className="px-4 py-3 text-gray-600">{new Date(e.lastSeenAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors && errors.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">No errors reported by this installation.</p>
        )}
        {!errors && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>
    </div>
  );
}
