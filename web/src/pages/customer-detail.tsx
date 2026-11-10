import { useEffect, useState } from "react";
import { api, ApiError, type Customer, type Installation } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate } from "@/lib/router";
import { StatusBadge } from "@/components/status-badge";
import { ApprovalModal } from "@/components/approval-modal";

type CustomerWithInstallations = Customer & { installations: Installation[] };

export function CustomerDetailPage({ id }: { id: number }) {
  const { admin } = useAuth();
  const canManage = !!admin?.permissions?.includes("customers.manage");
  const canRotate = admin?.role === "super_admin";

  const [customer, setCustomer] = useState<CustomerWithInstallations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dbUrlInput, setDbUrlInput] = useState("");
  const [approvedCode, setApprovedCode] = useState<string | null>(null);

  function load() {
    api
      .get<CustomerWithInstallations>(`/customers/${id}`)
      .then(setCustomer)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load this customer"));
  }

  useEffect(load, [id]);

  async function handleReveal() {
    setBusyAction("reveal");
    try {
      const { licenseKey } = await api.get<{ licenseKey: string }>(`/customers/${id}/license-key`);
      setRevealedKey(licenseKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reveal the license key");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRotate() {
    if (!confirm("Rotate this customer's license key? Already-activated installations keep working - only new activations need the new key.")) {
      return;
    }
    setBusyAction("rotate");
    try {
      const { licenseKey } = await api.post<{ licenseKey: string }>(`/customers/${id}/rotate-license-key`);
      setRevealedKey(licenseKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't rotate the license key");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    setBusyAction("provision");
    try {
      await api.post(`/customers/${id}/provision`, { databaseUrl: dbUrlInput });
      setDbUrlInput("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the database connection");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApprove() {
    setError(null);
    setBusyAction("approve");
    try {
      const result = await api.post<{ licenseKey: string }>(`/customers/${id}/approve`);
      setApprovedCode(result.licenseKey);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't approve this customer");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateCode(rotate: boolean) {
    if (rotate && !confirm("Create a NEW activation code? The old one stops working for new activations (tills already activated keep working).")) return;
    setError(null);
    setBusyAction("generate");
    try {
      const result = await api.post<{ licenseKey: string }>(`/customers/${id}/activation-code`, { rotate });
      setRevealedKey(result.licenseKey);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't generate the activation code");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReject() {
    if (!confirm("Decline this sign-up? They won't be able to activate.")) return;
    setBusyAction("reject");
    try {
      await api.post(`/customers/${id}/reject`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't decline this customer");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStatusToggle() {
    if (!customer) return;
    const suspending = customer.status === "active";
    const reason = window.prompt(
      suspending
        ? "Suspend this customer? Their installed apps will be blocked from the Master immediately.\n\nReason (recorded in the audit log):"
        : "Reactivate this customer?\n\nReason (recorded in the audit log):",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required.");
      return;
    }
    setBusyAction("status");
    try {
      await api.post(`/customers/${id}/${suspending ? "suspend" : "reactivate"}`, { reason: reason.trim() });
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the status");
    } finally {
      setBusyAction(null);
    }
  }

  if (error && !customer) {
    return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  }
  if (!customer) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <button onClick={() => navigate("/customers")} className="mb-4 text-sm text-gray-500 hover:text-gray-800">
        ← Back to customers
      </button>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-gray-500">{customer.businessName}</p>
        </div>
        {canManage && customer.status !== "pending" && (
          <button disabled={busyAction === "status"} className="btn-secondary" onClick={handleStatusToggle}>
            {customer.status === "active" ? "Suspend" : "Reactivate"}
          </button>
        )}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {customer.status === "pending" && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="mb-1 font-semibold text-amber-900">Waiting for your approval</h2>
          <p className="mb-3 text-sm text-amber-800">
            {customer.contactEmail ?? "This person"} signed up in the app.{" "}
            Approving creates their database automatically and gives you their activation code.
          </p>
          {canManage && (
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={busyAction === "approve"}
                onClick={handleApprove}
              >
                Approve &amp; get activation code
              </button>
              <button className="btn-secondary" disabled={busyAction === "reject"} onClick={handleReject}>
                Decline
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Contact</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Email</dt>
              <dd>{customer.contactEmail || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Phone</dt>
              <dd>{customer.contactPhone || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd className="capitalize">{customer.status}</dd>
            </div>
          </dl>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Activation code</h2>
          {revealedKey ? (
            <div className="mb-3 select-all rounded-lg bg-gray-50 p-2 font-mono text-sm">{revealedKey}</div>
          ) : (
            <p className="mb-3 text-sm text-gray-400">Hidden until revealed - each reveal is audit-logged.</p>
          )}
          {canManage && (
            <button
              disabled={busyAction === "generate" || customer.status === "suspended"}
              className="btn-primary mb-2 w-full"
              onClick={() => handleGenerateCode(false)}
            >
              {busyAction === "generate" ? "Setting up…" : "Generate activation code"}
            </button>
          )}
          <p className="mb-3 text-xs text-gray-500">
            Works any time: prepares the customer's database automatically and shows the code. Entering it in the app
            activates it and syncs everything.
          </p>
          <div className="flex gap-2">
            {canManage && (
              <button disabled={busyAction === "reveal"} className="btn-secondary flex-1" onClick={handleReveal}>
                Reveal
              </button>
            )}
            {canRotate && (
              <button disabled={busyAction === "rotate"} className="btn-secondary flex-1" onClick={handleRotate}>
                New code
              </button>
            )}
          </div>
        </div>
      </div>

      {canRotate && (
        <div className="card mb-6 p-5">
          <h2 className="mb-2 font-semibold">
            {customer.isProvisioned ? "Replace database connection" : "Use my own database (optional)"}
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            {customer.isProvisioned
              ? "Only replace this if the saved connection cannot be decrypted or you are moving this customer to another database. Already activated apps keep their current connection; new activations use this one."
              : "The Master creates a database automatically. Paste a connection string here only if you want to use a database you made yourself (it must already have its tables; run db:push on it)."}
          </p>
          <form onSubmit={handleProvision} className="flex gap-2">
            <input
              required
              className="input"
              placeholder={customer.isProvisioned ? "Replacement postgresql://..." : "postgresql://..."}
              value={dbUrlInput}
              onChange={(e) => setDbUrlInput(e.target.value)}
            />
            <button type="submit" disabled={busyAction === "provision"} className="btn-primary whitespace-nowrap">
              {customer.isProvisioned ? "Replace connection" : "Save"}
            </button>
          </form>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Installations</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {customer.installations.map((i) => (
              <tr
                key={i.id}
                className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                onClick={() => navigate(`/installations/${i.id}`)}
              >
                <td className="px-4 py-3 font-medium">{i.deviceName || i.installationCode}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={i.status} />
                </td>
                <td className="px-4 py-3 text-gray-600">{i.appVersion || "—"}</td>
                <td className="px-4 py-3 text-gray-600">
                  {i.lastSeenAt ? new Date(i.lastSeenAt).toLocaleString() : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customer.installations.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">No installations activated yet.</p>
        )}
      </div>
      {approvedCode && (
        <ApprovalModal email={customer.contactEmail} activationCode={approvedCode} onClose={() => setApprovedCode(null)} />
      )}
    </div>
  );
}
