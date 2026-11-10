import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { navigate, useRoute } from "@/lib/router";

import { api, type Customer, type FeedbackItem } from "@/lib/api";

const NAV_ITEMS: Array<{ label: string; path: string; match: (r: string[]) => boolean; perm?: string; badge?: "signups" | "feedback" }> = [
  { label: "Dashboard", path: "/", match: (r) => r.length === 0 },
  { label: "Sign-ups", path: "/signups", match: (r) => r[0] === "signups", badge: "signups", perm: "signups.review" },
  { label: "Customers", path: "/customers", match: (r) => r[0] === "customers", perm: "customers.view" },
  { label: "Installations", path: "/installations", match: (r) => r[0] === "installations", perm: "installations.view" },
  { label: "Incidents", path: "/incidents", match: (r) => r[0] === "incidents", perm: "incidents.view" },
  { label: "Feedback", path: "/feedback", match: (r) => r[0] === "feedback", badge: "feedback", perm: "feedback.view" },
  { label: "Releases", path: "/releases", match: (r) => r[0] === "releases", perm: "releases.view" },
  { label: "Audit log", path: "/audit-log", match: (r) => r[0] === "audit-log", perm: "audit.view" },
  { label: "Settings", path: "/settings", match: (r) => r[0] === "settings", perm: "settings.view" },
  { label: "Admins", path: "/admins", match: (r) => r[0] === "admins", perm: "admins.manage" },
  { label: "My account", path: "/account", match: (r) => r[0] === "account" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuth();
  const route = useRoute();
  const [counts, setCounts] = useState<{ signups: number; feedback: number }>({ signups: 0, feedback: 0 });

  // Little red numbers on "Sign-ups" and "Feedback" so nothing waits unnoticed.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Customer[]>("/customers?status=pending").catch(() => []),
      api.get<FeedbackItem[]>("/feedback?status=new").catch(() => []),
    ]).then(([s, f]) => {
      if (!cancelled) setCounts({ signups: s.length, feedback: f.length });
    });
    return () => {
      cancelled = true;
    };
  }, [route.join("/")]);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-5">
          <div className="text-sm font-semibold text-gray-400">MASTER APP</div>
          <div className="text-lg font-bold text-primary">TechWolf Inventory</div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.filter((item) => !item.perm || admin?.permissions?.includes(item.perm)).map((item) => {
            const active = item.match(route);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  active ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="flex items-center justify-between">
                  {item.label}
                  {item.badge && counts[item.badge] > 0 && (
                    <span className={`rounded-full px-2 text-xs font-bold ${active ? "bg-white text-primary" : "bg-red-500 text-white"}`}>
                      {counts[item.badge]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="border-t border-gray-100 p-4">
          <div className="mb-2 text-sm">
            <div className="font-medium text-gray-800">{admin?.name}</div>
            <div className="text-xs text-gray-400">{admin?.roleLabel ?? admin?.role.replace("_", " ")}</div>
          </div>
          <button onClick={logout} className="btn-secondary w-full">
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
