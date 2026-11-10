// Thin fetch wrapper for the Master API. Deliberately no dependency (no
// axios/react-query) - the API surface is small enough that plain fetch
// plus a bit of typing covers it without adding a dependency the rest of
// this standalone app doesn't otherwise need.

// Dev (separate :4200 server) talks to the API on :4100. The production build
// is served BY the API (/console/), so same-origin "/api" always works - on
// localhost, on the LAN address, or behind a domain - with no rebuild.
const API_URL =
  (import.meta.env.VITE_MASTER_API_URL as string | undefined) ||
  (import.meta.env.PROD ? "/api" : "http://localhost:4100/api");

const TOKEN_STORAGE_KEY = "masterAppToken";

let token: string | null = localStorage.getItem(TOKEN_STORAGE_KEY);

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  if (next) localStorage.setItem(TOKEN_STORAGE_KEY, next);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      // zod's .flatten() shape - surface the first field error found.
      const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      const firstField = flat.fieldErrors && Object.values(flat.fieldErrors).find((v) => v?.length);
      if (firstField?.[0]) return firstField[0];
      if (flat.formErrors?.[0]) return flat.formErrors[0];
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, `Couldn't reach the Master API at ${API_URL}. Is it running (npm run dev in MasterControl)?`);
  }

  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(res.status, extractErrorMessage(body, res.status));
  }
  return body as T;
}

/** Streams a File to the API as the raw request body (used for installer uploads), reporting progress. */
export function uploadFile<T>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${API_URL}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, `Couldn't reach the Master API at ${API_URL}.`));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, extractErrorMessage(body, xhr.status)));
    };
    xhr.send(file);
  });
}

export const api = {
  get: <T,>(path: string) => request<T>(path, { method: "GET" }),
  post: <T,>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T,>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
};

// ---- Types (mirrors MasterControl/api's response shapes) ----

export type AdminRole = "super_admin" | "support_admin" | "platform_ops" | "release_manager" | "monitoring_admin" | "auditor";

export interface Admin {
  id: number;
  name: string;
  email: string;
  role: AdminRole;
  roleLabel?: string;
  /** What this admin's role may do (the server enforces it; the UI only hides buttons that would be refused). */
  permissions?: string[];
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type ReleasePlatform = "windows" | "mac" | "linux";

export interface Release {
  id: number;
  version: string;
  platform: ReleasePlatform;
  arch: string;
  downloadFileName: string;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  mandatory: boolean;
  active: boolean;
  status: "draft" | "staged" | "published" | "withdrawn";
  rolloutPercent: number;
  minFromVersion: string | null;
  withdrawnReason: string | null;
  createdAt: string;
}

export interface ReleaseDeployments {
  release: Release;
  counts: { offered: number; downloaded: number; installed: number; failed: number; waiting: number };
  rows: { installationId: number; code: string; device: string | null; customer: string; appVersion: string | null; status: string; error: string | null; updatedAt: string }[];
}

export interface InstallationCommand {
  id: number;
  type: "sync" | "diagnostics";
  status: "queued" | "delivered" | "completed" | "failed";
  requestedAt: string;
  completedAt: string | null;
  result: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: number | null;
  description: string;
  createdAt: string;
  adminId: number | null;
  adminName: string | null;
  actorEmail?: string | null;
  outcome?: "success" | "failure";
  reason?: string | null;
  customerId?: number | null;
  installationId?: number | null;
  correlationId?: string | null;
  ip?: string | null;
}

export type CustomerStatus = "pending" | "active" | "suspended";

export interface Customer {
  id: number;
  name: string;
  businessName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  status: CustomerStatus;
  isProvisioned: boolean;
  /** Legacy marker for customers created by the removed desktop sign-up flow. */
  hasSignupAccount?: boolean;
  signupSource?: string;
  approvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InstallationStatus = "online" | "warning" | "offline" | "critical" | "unknown";

export interface Installation {
  id: number;
  installationCode: string;
  customerId: number;
  customerName: string;
  deviceName: string | null;
  appVersion: string | null;
  osVersion: string | null;
  lastSeenAt: string | null;
  lastHealthStatus: string | null;
  lastSyncStatus: string | null;
  productCount: number | null;
  customerCount: number | null;
  pendingCount: number | null;
  conflictCount: number | null;
  failedCount: number | null;
  lastSyncAt: string | null;
  createdAt: string;
  status: InstallationStatus;
}

export type ErrorSeverity = "info" | "warning" | "error" | "critical";
export type ErrorStatus = "open" | "investigating" | "resolved" | "ignored";

export interface InstallationError {
  id: number;
  installationId: number;
  module: string | null;
  severity: ErrorSeverity;
  message: string;
  status: ErrorStatus;
  occurrences: number;
  lastSeenAt: string;
}

export interface DashboardSummary {
  totalProducts: number;
  pendingChanges: number;
  needAttention: number;
  customers: number;
  installations: number;
  online: number;
  warning: number;
  offline: number;
  critical: number;
  errorsToday: number;
}

export type FeedbackStatus = "new" | "read" | "resolved";

export interface FeedbackItem {
  id: number;
  customerId: number;
  customerName: string;
  customerContact: string | null;
  fromEmail: string | null;
  category: "general" | "problem" | "idea" | "praise";
  rating: number | null;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
}

export interface DashboardOverview {
  generatedAt: string;
  rangeDays: number;
  customers: { total: number; pending: number; active: number; suspended: number; newInPeriod: number };
  installations: {
    total: number; online: number; offline: number; warning: number; critical: number; unknown: number;
    needAttention: number; versions: { version: string; count: number }[];
  };
  sync: { pendingChanges: number; installationsPendingSync: number; failedChanges: number; conflicts: number; lastSuccessfulSyncAt: string | null };
  errors: { today: number; openCritical: number; repeatedGroups: number };
  health: { api: string; database: string; databaseLatencyMs: number };
  releases: { latest: { platform: string; version: string }[]; installationsOnLatest: number; installationsTotal: number };
  trends: {
    registrations: { day: string; n: number }[];
    errors: { day: string; n: number }[];
    connectivity: { t: string; online: number; offline: number; warning: number; critical: number; pending: number; failed: number }[];
  };
  recent: {
    customers: { id: number; name: string; status: string; createdAt: string }[];
    criticalErrors: { id: number; installationId: number; message: string; module: string | null; occurrences: number; status: string; lastSeenAt: string }[];
    activity: { id: number; code: string; device: string | null; customer: string; status: InstallationStatus; lastSeenAt: string | null }[];
  };
  attention: { id: number; code: string; device: string | null; customer: string; status: InstallationStatus; reasons: string[]; lastSeenAt: string | null }[];
  unavailable: Record<string, string>;
}

/** Downloads a file from an authenticated endpoint (e.g. the audit CSV) and saves it in the browser. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, extractErrorMessage(body, res.status));
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
