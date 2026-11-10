import type { InstallationStatus } from "@/lib/api";

const STYLES: Record<InstallationStatus, string> = {
  online: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  offline: "bg-gray-100 text-gray-600",
  critical: "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-500",
};

const DOT: Record<InstallationStatus, string> = {
  online: "bg-green-500",
  warning: "bg-amber-500",
  offline: "bg-gray-400",
  critical: "bg-red-500",
  unknown: "bg-gray-300",
};

export function StatusBadge({ status }: { status: InstallationStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} />
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}
