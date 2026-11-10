import { useEffect, useState } from "react";
import { api, ApiError, type FeedbackItem, type FeedbackStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { navigate } from "@/lib/router";

const CATEGORY_STYLES: Record<FeedbackItem["category"], string> = {
  problem: "bg-red-100 text-red-800",
  idea: "bg-blue-100 text-blue-800",
  praise: "bg-green-100 text-green-800",
  general: "bg-gray-100 text-gray-700",
};
const CATEGORY_LABELS: Record<FeedbackItem["category"], string> = {
  problem: "Problem",
  idea: "Idea",
  praise: "Praise",
  general: "General",
};

/** What customers sent from Settings -> Send feedback inside the app. */
export function FeedbackPage() {
  const { admin } = useAuth();
  const canManage = !!admin?.permissions?.includes("feedback.manage");
  const [filter, setFilter] = useState<"all" | FeedbackStatus>("all");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<FeedbackItem[]>(`/feedback${filter === "all" ? "" : `?status=${filter}`}`)
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load feedback"));
  }
  useEffect(load, [filter]);

  async function setStatus(id: number, status: FeedbackStatus) {
    try {
      await api.put(`/feedback/${id}`, { status });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this message");
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Customer feedback</h1>
      <p className="mb-5 text-sm text-gray-500">Messages customers sent from inside the app.</p>

      <div className="mb-4 flex gap-2">
        {(["all", "new", "read", "resolved"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
              filter === f ? "bg-primary text-white" : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="space-y-3">
        {items?.map((f) => (
          <div key={f.id} className={`card p-4 ${f.status === "new" ? "border-l-4 border-l-primary" : ""}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[f.category]}`}>
                {CATEGORY_LABELS[f.category]}
              </span>
              {f.rating != null && <span className="text-amber-500">{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</span>}
              <button className="font-medium hover:underline" onClick={() => navigate(`/customers/${f.customerId}`)}>
                {f.customerName || f.customerContact || `Customer #${f.customerId}`}
              </button>
              {f.fromEmail && <span className="text-gray-400">· {f.fromEmail}</span>}
              <span className="ml-auto text-xs text-gray-400">{new Date(f.createdAt).toLocaleString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-800">{f.message}</p>
            {canManage && (
              <div className="mt-3 flex gap-2">
                {f.status !== "read" && f.status !== "resolved" && (
                  <button className="btn-secondary" onClick={() => setStatus(f.id, "read")}>
                    Mark read
                  </button>
                )}
                {f.status !== "resolved" ? (
                  <button className="btn-secondary" onClick={() => setStatus(f.id, "resolved")}>
                    Resolve
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={() => setStatus(f.id, "new")}>
                    Reopen
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {items && items.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">Nothing here.</p>}
        {!items && !error && <p className="text-sm text-gray-400">Loading…</p>}
      </div>
    </div>
  );
}
