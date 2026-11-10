import { useEffect, useState } from "react";
import { api, ApiError, type Customer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate, useQueryParams } from "@/lib/router";
import { Modal } from "@/components/modal";

export function CustomersPage() {
  const { admin } = useAuth();
  const canCreate = !!admin?.permissions?.includes("customers.manage");

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState("");
  const statusParam = useQueryParams().get("status") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newLicenseKey, setNewLicenseKey] = useState<string | null>(null);

  function load(q: string) {
    setError(null);
    const params = new URLSearchParams();
    if (q) params.set("search", q);
    if (statusParam) params.set("status", statusParam);
    api
      .get<Customer[]>(`/customers${params.toString() ? `?${params}` : ""}`)
      .then(setCustomers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load customers"));
  }

  useEffect(() => {
    const timeout = setTimeout(() => load(search), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusParam]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Customers</h1>
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Add customer
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {["", "pending", "active", "suspended"].map((st) => (
          <button
            key={st || "all"}
            onClick={() => navigate(st ? `/customers?status=${st}` : "/customers")}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${statusParam === st ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            {st === "" ? "All" : st === "pending" ? "Awaiting approval" : st[0].toUpperCase() + st.slice(1)}
          </button>
        ))}
      </div>

      <input
        className="input mb-4 max-w-sm"
        placeholder="Search by name, business, or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Database</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
                onClick={() => navigate(`/customers/${c.id}`)}
              >
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-gray-600">{c.businessName || c.contactEmail || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === "active"
                        ? "bg-green-100 text-green-800"
                        : c.status === "pending"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {c.status === "pending" ? "awaiting approval" : c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {c.isProvisioned ? "Provisioned" : "Created on first code"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers && customers.length === 0 && (
          <p className="p-6 text-center text-sm text-gray-400">No customers yet.</p>
        )}
        {!customers && !error && <p className="p-6 text-center text-sm text-gray-400">Loading…</p>}
      </div>

      {showCreate && (
        <CreateCustomerModal
          onClose={() => setShowCreate(false)}
          onCreated={(licenseKey) => {
            setShowCreate(false);
            setNewLicenseKey(licenseKey);
            load(search);
          }}
        />
      )}

      {newLicenseKey && (
        <Modal title="Customer created" onClose={() => setNewLicenseKey(null)}>
          <p className="mb-3 text-sm text-gray-600">
            Give this license key to the customer - it's shown in full only this once. You can view it
            again later from their detail page (each view is logged), or rotate it if it ever leaks.
          </p>
          <div className="mb-4 select-all rounded-lg bg-gray-50 p-3 font-mono text-sm">{newLicenseKey}</div>
          <button className="btn-primary w-full" onClick={() => setNewLicenseKey(null)}>
            Done
          </button>
        </Modal>
      )}
    </div>
  );
}

function CreateCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (licenseKey: string) => void;
}) {
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ licenseKey: string }>("/customers", {
        name,
        businessName,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
      });
      onCreated(result.licenseKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the customer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add customer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <input required placeholder="Contact name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          required
          placeholder="Business name"
          className="input"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <input
          type="email"
          placeholder="Contact email (optional)"
          className="input"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        <input
          placeholder="Contact phone (optional)"
          className="input"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
        />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create customer"}
        </button>
      </form>
    </Modal>
  );
}
