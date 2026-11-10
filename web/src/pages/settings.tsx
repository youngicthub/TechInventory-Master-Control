import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Def { key: string; group: string; label: string; unit: string; min: number; max: number; default: number; description: string; value: number }

export function SettingsPage() {
  const { can } = useAuth();
  const canManage = can("settings.manage");
  const [defs, setDefs] = useState<Def[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<Def[]>("/settings").then((d) => { setDefs(d); setDraft(Object.fromEntries(d.map((x) => [x.key, String(x.value)]))); })
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't load settings" }));
  }
  useEffect(load, []);

  async function save() {
    if (!defs) return;
    const values: Record<string, number> = {};
    for (const d of defs) {
      const n = Number(draft[d.key]);
      if (!Number.isInteger(n) || n < d.min || n > d.max) { setMsg({ ok: false, text: `${d.label} must be a whole number between ${d.min} and ${d.max} ${d.unit}.` }); return; }
      if (n !== d.value) values[d.key] = n;
    }
    if (Object.keys(values).length === 0) { setMsg({ ok: true, text: "Nothing changed." }); return; }
    if (!window.confirm(`Save ${Object.keys(values).length} change(s)? Heartbeat and alert rules apply to every installation straight away.`)) return;
    setBusy(true);
    try {
      await api.put("/settings", { values, reason: reason.trim() || undefined });
      setMsg({ ok: true, text: "Saved. The change is recorded in the audit log." });
      setReason(""); load();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't save" }); } finally { setBusy(false); }
  }

  const groups = [...new Set((defs ?? []).map((d) => d.group))];
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Platform settings</h1>
      <p className="mb-4 text-sm text-gray-500">Thresholds used for online/offline status and alerts. Secrets and environment settings are never shown here.</p>
      {msg && <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
      {!defs && <p className="text-gray-400">Loading…</p>}
      {groups.map((g) => (
        <div key={g} className="card mb-4 p-5">
          <h2 className="mb-3 font-semibold">{g}</h2>
          <div className="space-y-4">
            {defs!.filter((d) => d.group === g).map((d) => (
              <div key={d.key}>
                <label className="text-sm font-medium" htmlFor={d.key}>{d.label}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input id={d.key} className="input !w-32" inputMode="numeric" disabled={!canManage} value={draft[d.key] ?? ""} onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })} />
                  <span className="text-sm text-gray-500">{d.unit} (allowed {d.min}–{d.max}, default {d.default})</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{d.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
      {canManage && defs && (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input !w-72" placeholder="Reason (optional, kept in the audit log)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      )}
      {!canManage && defs && <p className="text-sm text-gray-500">Your role can view these settings but not change them.</p>}
    </div>
  );
}
