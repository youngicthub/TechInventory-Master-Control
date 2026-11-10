import { useEffect, useState } from "react";
import { api, ApiError, type Admin, type AdminRole } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Modal } from "@/components/modal";

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super administrator",
  support_admin: "Customer support",
  platform_ops: "Platform operations",
  release_manager: "Release manager",
  monitoring_admin: "Monitoring (view only)",
  auditor: "Read-only auditor",
};

export function AdminsPage() {
  const { admin: me } = useAuth();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [secret, setSecret] = useState<{ title: string; password: string } | null>(null);

  function load() {
    api
      .get<Admin[]>("/admins")
      .then(setAdmins)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load admins"));
  }
  useEffect(load, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admins</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add admin
        </button>
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last login</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {admins?.map((a) => {
              const isMe = a.id === me?.id;
              return (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {a.name} {isMe && <span className="text-xs text-gray-400">(you)</span>}
                    </div>
                    <div className="text-xs text-gray-500">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input !w-auto !py-1"
                      value={a.role}
                      disabled={isMe}
                      onChange={(e) => act(() => api.put(`/admins/${a.id}`, { role: e.target.value }))}
                    >
                      {Object.entries(ROLE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                      {a.active ? "Active" : "Deactivated"}
                    </span>
                    {a.mustChangePassword && <span className="ml-2 text-xs text-amber-700">temp password</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td className="space-x-2 px-4 py-3 text-right">
                    {!isMe && (
                      <>
                        <button
                          className="btn-secondary !px-2 !py-1 text-xs"
                          onClick={() =>
                            confirmThen(`Reset the password for ${a.name}? They'll be signed out.`, () =>
                              act(async () => {
                                const r = await api.post<{ temporaryPassword: string }>(`/admins/${a.id}/reset-password`);
                                setSecret({ title: `New temporary password for ${a.name}`, password: r.temporaryPassword });
                              }),
                            )
                          }
                        >
                          Reset password
                        </button>
                        <button
                          className="btn-secondary !px-2 !py-1 text-xs"
                          onClick={() => {
                            const reason = window.prompt(`End every session ${a.name} has? They must sign in again.\n\nReason (recorded in the audit log):`);
                            if (reason !== null) act(() => api.post(`/admins/${a.id}/revoke-sessions`, { reason }));
                          }}
                        >
                          End sessions
                        </button>
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => act(() => api.put(`/admins/${a.id}`, { active: !a.active }))}>
                          {a.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!admins && !error && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>

      {showCreate && (
        <CreateAdminModal
          onClose={() => setShowCreate(false)}
          onCreated={(name, password) => {
            setShowCreate(false);
            setSecret({ title: `Temporary password for ${name}`, password });
            load();
          }}
        />
      )}

      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)}>
          <p className="mb-3 text-sm text-gray-600">
            Give this to them privately - it's shown only now. They'll be asked to choose their own password at first login.
          </p>
          <div className="mb-4 select-all rounded-lg bg-gray-50 p-3 font-mono text-sm">{secret.password}</div>
          <button className="btn-primary w-full" onClick={() => setSecret(null)}>
            Done
          </button>
        </Modal>
      )}
    </div>
  );
}

function confirmThen(message: string, fn: () => void) {
  if (window.confirm(message)) fn();
}

function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, password: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("monitoring_admin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ admin: Admin; temporaryPassword: string }>("/admins", { name, email, role });
      onCreated(r.admin.name, r.temporaryPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the admin");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add admin" onClose={onClose}>
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <form onSubmit={submit} className="space-y-3">
        <input required className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input required type="email" className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
          {Object.entries(ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create admin"}
        </button>
      </form>
    </Modal>
  );
}
