import { db, platformSettingsTable } from "@masterctl/db";

export interface SettingDef {
  key: string;
  group: "Heartbeat" | "Alerts";
  label: string;
  description: string;
  unit: string;
  default: number;
  min: number;
  max: number;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: "heartbeat.offlineAfterSeconds", group: "Heartbeat", label: "Offline after", unit: "seconds", min: 30, max: 86_400,
    default: Number(process.env.MASTER_OFFLINE_THRESHOLD_SECONDS ?? 120),
    description: "An installation that hasn't sent a heartbeat for this long is shown as offline. Apps send one every 30 seconds." },
  { key: "alerts.repeatedErrorOccurrences", group: "Alerts", label: "Repeated critical failure at", unit: "occurrences", min: 2, max: 10_000, default: 5,
    description: "Raise an alert when an unresolved critical incident has happened this many times." },
  { key: "alerts.outageMinutes", group: "Alerts", label: "Prolonged outage after", unit: "minutes", min: 5, max: 10_080, default: 30,
    description: "Raise an alert when an installation of an active customer has been silent for this long." },
  { key: "alerts.syncBacklogChanges", group: "Alerts", label: "Sync backlog at", unit: "changes", min: 5, max: 100_000, default: 100,
    description: "Raise an alert when one installation has this many changes waiting to sync." },
  { key: "alerts.unacknowledgedCriticalMinutes", group: "Alerts", label: "Unacknowledged critical after", unit: "minutes", min: 1, max: 10_080, default: 15,
    description: "Raise an alert when a critical incident has been new and unacknowledged for this long." },
];

const cache = new Map<string, number>();

export async function loadSettings(): Promise<void> {
  try {
    const rows = await db.select().from(platformSettingsTable);
    for (const r of rows) {
      const n = Number(JSON.parse(r.value));
      if (Number.isFinite(n)) cache.set(r.key, n);
    }
  } catch (err) {
    console.error("[master-api] couldn't load platform settings (using defaults):", err instanceof Error ? err.message : err);
  }
}

export function getSetting(key: string): number {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  return cache.get(key) ?? def.default;
}

export function setCached(key: string, value: number): void {
  cache.set(key, value);
}
