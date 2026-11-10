import { useEffect, useRef, useState } from "react";
import { api, ApiError, uploadFile, type Release, type ReleaseDeployments, type ReleasePlatform } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Modal } from "@/components/modal";

const PLATFORM_LABEL: Record<ReleasePlatform, string> = { windows: "Windows", mac: "macOS", linux: "Linux" };

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ReleasesPage() {
  const { admin } = useAuth();
  const canManage = !!admin?.permissions?.includes("releases.publish");
  const canRollback = !!admin?.permissions?.includes("releases.rollback");
  const [progressFor, setProgressFor] = useState<Release | null>(null);
  const [rollbackFor, setRollbackFor] = useState<Release | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  function load() {
    api
      .get<Release[]>("/releases")
      .then(setReleases)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load releases"));
  }
  useEffect(load, []);

  async function transition(r: Release, to: "staged" | "published" | "withdrawn") {
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = { to };
    if (to === "staged") {
      const pct = Number(window.prompt(`Offer ${r.version} to what percentage of installed apps? (1-99)`, "10"));
      if (!Number.isInteger(pct) || pct < 1 || pct > 99) return;
      body.rolloutPercent = pct;
    } else if (to === "published") {
      if (!window.confirm(`Publish ${r.version} to EVERYONE?\n\nIt goes on the download page and is offered to every installed app as an update.`)) return;
      body.confirm = true;
    } else {
      const reason = window.prompt(r.status === "withdrawn" ? "Reason for putting this build back live:" : `Withdraw ${r.version}? Reason (recorded in the audit log):`);
      if (reason === null) return;
      body.reason = reason;
    }
    try {
      await api.post(`/releases/${r.id}/transition`, body);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work");
    }
  }

  async function patch(id: number, body: Partial<Pick<Release, "mandatory">>) {
    setError(null);
    try {
      await api.put(`/releases/${id}`, body);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Releases</h1>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowUpload(true)}>
            + Upload build
          </button>
        )}
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Uploads start as drafts. Stage a build to offer it to a percentage of installed apps first, then publish it to everyone (that is
        also what puts it on the download page). "Required" blocks the app until it's updated.
      </p>
      {notice && <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{notice}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">System</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {releases?.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-3">
                  <div className="font-semibold">{r.version}</div>
                  {r.notes && <div className="max-w-xs text-xs text-gray-500">{r.notes}</div>}
                </td>
                <td className="px-4 py-3">
                  {PLATFORM_LABEL[r.platform]} <span className="text-xs text-gray-400">{r.arch}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">{formatSize(r.sizeBytes)}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.status === "published" ? "bg-green-100 text-green-800" : r.status === "staged" ? "bg-blue-100 text-blue-800" : r.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {r.status === "staged" ? `Staged · ${r.rolloutPercent}%` : r.status === "published" ? "Published" : r.status === "draft" ? "Draft" : "Withdrawn"}
                  </span>
                  {r.status === "withdrawn" && r.withdrawnReason && <div className="mt-1 max-w-[12rem] text-xs text-gray-500">{r.withdrawnReason}</div>}
                  {r.mandatory && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Required</span>}
                </td>
                <td className="space-x-2 px-4 py-3 text-right">
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setProgressFor(r)}>
                    Progress
                  </button>
                  {canManage && (
                    <>
                      {(r.status === "draft" || r.status === "withdrawn" || r.status === "staged") && (
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => transition(r, "staged")}>
                          {r.status === "staged" ? "Change %" : "Stage…"}
                        </button>
                      )}
                      {r.status !== "published" && r.status !== "withdrawn" && (
                        <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => transition(r, "published")}>
                          Publish
                        </button>
                      )}
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => patch(r.id, { mandatory: !r.mandatory })}>
                        {r.mandatory ? "Make optional" : "Make required"}
                      </button>
                    </>
                  )}
                  {canRollback && r.status === "published" && (
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setRollbackFor(r)}>
                      Roll back…
                    </button>
                  )}
                  {canRollback && r.status === "staged" && (
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => transition(r, "withdrawn")}>
                      Withdraw
                    </button>
                  )}
                  {canManage && r.status === "withdrawn" && (
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => transition(r, "published")}>
                      Re-publish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {releases && releases.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No builds uploaded yet.</p>}
        {!releases && !error && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>

      {progressFor && <ProgressModal release={progressFor} onClose={() => setProgressFor(null)} />}
      {rollbackFor && (
        <RollbackModal
          release={rollbackFor}
          candidates={(releases ?? []).filter((x) => x.id !== rollbackFor.id && x.platform === rollbackFor.platform && x.arch === rollbackFor.arch && x.status !== "draft")}
          onClose={() => setRollbackFor(null)}
          onDone={(note) => {
            setRollbackFor(null);
            setNotice(note);
            load();
          }}
        />
      )}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState<ReleasePlatform>("windows");
  const [arch, setArch] = useState("x64");
  const [notes, setNotes] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose the installer file first.");
    setError(null);
    setProgress(0);
    const qs = new URLSearchParams({ version, platform, arch, filename: file.name, mandatory: String(mandatory) });
    if (notes.trim()) qs.set("notes", notes.trim());
    try {
      await uploadFile(`/releases/upload?${qs.toString()}`, file, setProgress);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <Modal title="Upload build" onClose={busy ? () => undefined : onClose}>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={submit} className="space-y-3">
        <input required className="input" placeholder="Version, e.g. 1.2.0" value={version} onChange={(e) => setVersion(e.target.value)} />
        <div className="flex gap-2">
          <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as ReleasePlatform)}>
            {Object.entries(PLATFORM_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select className="input" value={arch} onChange={(e) => setArch(e.target.value)}>
            <option value="x64">x64 (Intel/AMD)</option>
            <option value="arm64">arm64 (Apple Silicon)</option>
          </select>
        </div>
        <input ref={fileRef} required type="file" accept=".exe,.msi,.dmg,.zip,.pkg,.appimage,.deb,.rpm,.gz" className="input" />
        <textarea className="input" rows={3} placeholder="What's new (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
          Required update (blocks older versions until updated)
        </label>
        {busy && (
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload"}
        </button>
      </form>
    </Modal>
  );
}


function ProgressModal({ release, onClose }: { release: Release; onClose: () => void }) {
  const [data, setData] = useState<ReleaseDeployments | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      api
        .get<ReleaseDeployments>(`/releases/${release.id}/deployments`)
        .then(setData)
        .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load progress"));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [release.id]);
  return (
    <Modal title={`Progress · ${release.version} (${PLATFORM_LABEL[release.platform]})`} onClose={onClose}>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}
      {data && (
        <>
          <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
            {[
              ["Waiting", data.counts.waiting, "text-gray-700"],
              ["Offered", data.counts.offered, "text-blue-700"],
              ["Downloaded", data.counts.downloaded, "text-amber-700"],
              ["Installed", data.counts.installed, "text-green-700"],
              ["Failed", data.counts.failed, "text-red-700"],
            ].map(([label, n, cls]) => (
              <div key={String(label)} className="rounded-lg bg-gray-50 p-2">
                <div className={`text-lg font-bold ${cls}`}>{n}</div>
                {label}
              </div>
            ))}
          </div>
          <p className="mb-3 text-xs text-gray-500">
            "Installed" counts only apps that reported running this version. "Waiting" are apps that would be offered it but haven't asked yet (offline or not checked since it went live).
          </p>
          <div className="max-h-64 overflow-auto text-sm">
            {data.rows.length === 0 && <p className="text-gray-400">No app has been offered this build yet.</p>}
            {data.rows.map((r) => (
              <div key={r.installationId} className="flex items-center justify-between border-t border-gray-100 py-1.5">
                <span>
                  {r.device || r.code} <span className="text-xs text-gray-400">{r.customer}</span>
                </span>
                <span className={r.status === "failed" ? "text-red-700" : r.status === "installed" ? "text-green-700" : "text-gray-600"} title={r.error ?? undefined}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function RollbackModal({ release, candidates, onClose, onDone }: { release: Release; candidates: Release[]; onClose: () => void; onDone: (note: string) => void }) {
  const older = candidates.filter((c) => c.version !== release.version);
  const [to, setTo] = useState(older[0]?.id ?? 0);
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ note: string }>(`/releases/${release.id}/rollback`, { toReleaseId: to, reason, confirm: true });
      onDone(r.note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rollback failed");
    }
  }
  return (
    <Modal title={`Roll back ${release.version}`} onClose={onClose}>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {older.length === 0 ? (
        <p className="text-sm text-gray-500">There is no earlier build for this system to go back to.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-gray-600">
            This withdraws {release.version} and makes an earlier build the current one. Apps that already installed {release.version} are not downgraded - they move on when a newer fixed build is published.
          </p>
          <select className="input" value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {older.map((c) => (
              <option key={c.id} value={c.id}>
                Go back to {c.version} ({c.status})
              </option>
            ))}
          </select>
          <input required minLength={3} className="input" placeholder="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I understand this changes what every device is offered
          </label>
          <button disabled={!sure || reason.trim().length < 3} className="btn-primary w-full">
            Roll back
          </button>
        </form>
      )}
    </Modal>
  );
}
