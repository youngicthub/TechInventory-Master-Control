import { useEffect, useState } from "react";
import { api, ApiError, type Customer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate } from "@/lib/router";
import { ApprovalModal } from "@/components/approval-modal";

/** People who signed up in the app and are waiting for you. Approving releases their activation code. */
export function SignupsPage() {
  const { admin } = useAuth();
  const canManage = !!admin?.permissions?.includes("signups.review");

  const [pending, setPending] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [approved, setApproved] = useState<{ email: string | null; code: string } | null>(null);

  function load() {
    api
      .get<Customer[]>("/customers?status=pending")
      .then((rows) => setPending(rows))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load sign-ups"));
  }
  useEffect(load, []);

  async function approve(c: Customer) {
    setError(null);
    setBusyId(c.id);
    try {
      const result = await api.post<Customer & { licenseKey: string }>(`/customers/${c.id}/approve`);
      setApproved({ email: c.contactEmail, code: result.licenseKey });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve this sign-up");
    } finally {
      setBusyId(null);
    }
  }

  async function decline(c: Customer) {
    if (!confirm(`Decline ${c.contactEmail ?? c.name}? They won't be able to activate.`)) return;
    setBusyId(c.id);
    try {
      await api.post(`/customers/${c.id}/reject`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decline this sign-up");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Sign-ups</h1>
      <p className="mb-6 text-sm text-gray-500">
        People who created an account in the app. For each one: <b>1)</b> create their database and run{" "}
        <code>db:push</code> on it, <b>2)</b> paste its connection string on their page, <b>3)</b> approve - then
        send them the activation code.
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Database</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {pending?.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium">{c.contactEmail ?? c.name}</td>
                <td className="px-4 py-3 text-gray-600">{new Date(c.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {c.isProvisioned ? "Database ready" : "Auto-setup on approve"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button className="btn-secondary" onClick={() => navigate(`/customers/${c.id}`)}>
                      Open
                    </button>
                    {canManage && (
                      <>
                        <button
                          className="btn-primary"
                          disabled={busyId === c.id}
                          onClick={() => approve(c)}
                        >
                          Approve
                        </button>
                        <button className="btn-secondary" disabled={busyId === c.id} onClick={() => decline(c)}>
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pending && pending.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No one is waiting. 🎉</p>}
        {!pending && !error && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>

      {approved && <ApprovalModal email={approved.email} activationCode={approved.code} onClose={() => setApproved(null)} />}
    </div>
  );
}
