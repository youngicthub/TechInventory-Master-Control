import {
  serial,
  integer,
  bigint,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { masterAdminsTable } from "./admins";
import { releasePlatformEnum } from "./enums";

/**
 * One row per uploaded installer build (one per platform/arch per version).
 * Serves two audiences from the same table:
 *   - the public landing page's download buttons (latest ACTIVE build per platform)
 *   - installed apps checking for updates (latest ACTIVE build newer than theirs)
 *
 * The file itself lives on this server's disk (MASTER_RELEASES_DIR), never in
 * the database. `sha256` is computed while the upload streams in, and is what
 * an installed app checks the downloaded file against before running it.
 */
export const appReleasesTable = masterControlSchema.table(
  "app_releases",
  {
    id: serial("id").primaryKey(),
    version: text("version").notNull(), // semver, e.g. "1.4.0"
    platform: releasePlatformEnum("platform").notNull(),
    arch: text("arch").notNull().default("x64"), // "x64" | "arm64"
    storedFileName: text("stored_file_name").notNull(), // server-generated, never user-controlled
    downloadFileName: text("download_file_name").notNull(), // the friendly name the browser saves it as
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    notes: text("notes"),
    // Installed apps older than this release must update (the app shows a
    // blocking "update required" prompt instead of an optional one).
    mandatory: boolean("mandatory").notNull().default(false),
    // Inactive = withdrawn: hidden from the landing page and update checks,
    // but the row and file are kept so it can be re-enabled.
    active: boolean("active").notNull().default(true),
    // Lifecycle: draft (uploaded, nobody can get it) -> staged (a % of installed apps are offered it)
    // -> published (everyone, and the landing page) -> withdrawn. `active` above is kept in step:
    // it is true only for staged/published, so everything that already reads it keeps working.
    status: text("status").notNull().default("published"),
    // Percentage of installed apps that are offered this build as an update (landing-page downloads are unaffected).
    rolloutPercent: integer("rollout_percent").notNull().default(100),
    // Only apps already on this version or newer are offered it (compatibility floor).
    minFromVersion: text("min_from_version"),
    publishedAt: timestamp("published_at"),
    publishedBy: integer("published_by").references(() => masterAdminsTable.id, { onDelete: "set null" }),
    withdrawnAt: timestamp("withdrawn_at"),
    withdrawnReason: text("withdrawn_reason"),
    uploadedBy: integer("uploaded_by").references(() => masterAdminsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("app_releases_version_platform_arch_idx").on(table.version, table.platform, table.arch)],
);

export type AppRelease = typeof appReleasesTable.$inferSelect;
