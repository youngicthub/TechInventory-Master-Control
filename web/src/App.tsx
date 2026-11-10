import { AuthProvider, useAuth } from "@/lib/auth";
import { useRoute } from "@/lib/router";
import { Layout } from "@/components/layout";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { CustomersPage } from "@/pages/customers";
import { CustomerDetailPage } from "@/pages/customer-detail";
import { InstallationsPage } from "@/pages/installations";
import { InstallationDetailPage } from "@/pages/installation-detail";
import { ReleasesPage } from "@/pages/releases";
import { AuditLogsPage } from "@/pages/audit-logs";
import { AdminsPage } from "@/pages/admins";
import { AccountPage } from "@/pages/account";
import { SignupsPage } from "@/pages/signups";
import { FeedbackPage } from "@/pages/feedback";
import { IncidentsPage, IncidentDetailPage } from "@/pages/incidents";
import { SettingsPage } from "@/pages/settings";

function Router() {
  const route = useRoute();

  if (route[0] === "customers" && route[1]) {
    return <CustomerDetailPage id={Number(route[1])} />;
  }
  if (route[0] === "customers") {
    return <CustomersPage />;
  }
  if (route[0] === "installations" && route[1]) {
    return <InstallationDetailPage id={Number(route[1])} />;
  }
  if (route[0] === "installations") {
    return <InstallationsPage />;
  }
  if (route[0] === "signups") {
    return <SignupsPage />;
  }
  if (route[0] === "feedback") {
    return <FeedbackPage />;
  }
  if (route[0] === "releases") {
    return <ReleasesPage />;
  }
  if (route[0] === "incidents" && route[1]) {
    return <IncidentDetailPage id={Number(route[1])} />;
  }
  if (route[0] === "incidents") {
    return <IncidentsPage />;
  }
  if (route[0] === "settings") {
    return <SettingsPage />;
  }
  if (route[0] === "audit-log") {
    return <AuditLogsPage />;
  }
  if (route[0] === "admins") {
    return <AdminsPage />;
  }
  if (route[0] === "account") {
    return <AccountPage />;
  }
  return <DashboardPage />;
}

function Shell() {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">Loading…</div>
    );
  }
  if (!admin) {
    return <LoginPage />;
  }
  // Accounts created or reset by another admin must pick their own password
  // before they can see anything else.
  if (admin.mustChangePassword) {
    return <AccountPage forced />;
  }
  return (
    <Layout>
      <Router />
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
