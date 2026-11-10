import { pool, describeDbError } from "./index";

const STATEMENTS: string[] = [
  // ---- installation live-monitoring columns
  `ALTER TABLE IF EXISTS master_control.installations
     ADD COLUMN IF NOT EXISTS product_count integer,
     ADD COLUMN IF NOT EXISTS customer_count integer,
     ADD COLUMN IF NOT EXISTS pending_count integer,
     ADD COLUMN IF NOT EXISTS conflict_count integer,
     ADD COLUMN IF NOT EXISTS failed_count integer,
     ADD COLUMN IF NOT EXISTS last_sync_at timestamp,
     ADD COLUMN IF NOT EXISTS last_activated_at timestamp`,

  // ---- dashboard trend snapshots
  `CREATE TABLE IF NOT EXISTS master_control.metric_snapshots (
     id serial PRIMARY KEY,
     taken_at timestamp NOT NULL DEFAULT now(),
     online integer NOT NULL DEFAULT 0, offline integer NOT NULL DEFAULT 0,
     warning integer NOT NULL DEFAULT 0, critical integer NOT NULL DEFAULT 0, unknown integer NOT NULL DEFAULT 0,
     pending_changes integer NOT NULL DEFAULT 0, failed_changes integer NOT NULL DEFAULT 0, conflicts integer NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS metric_snapshots_taken_idx ON master_control.metric_snapshots (taken_at)`,

  // ---- release lifecycle, revocation, command queue, deployment tracking
  `ALTER TABLE IF EXISTS master_control.app_releases
     ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
     ADD COLUMN IF NOT EXISTS rollout_percent integer NOT NULL DEFAULT 100,
     ADD COLUMN IF NOT EXISTS min_from_version text,
     ADD COLUMN IF NOT EXISTS published_at timestamp,
     ADD COLUMN IF NOT EXISTS published_by integer,
     ADD COLUMN IF NOT EXISTS withdrawn_at timestamp,
     ADD COLUMN IF NOT EXISTS withdrawn_reason text`,
  // Builds that were switched off before this existed are withdrawn, not published.
  `UPDATE master_control.app_releases SET status = 'withdrawn' WHERE active = false AND status = 'published' AND withdrawn_at IS NULL AND published_at IS NULL`,
  `ALTER TABLE IF EXISTS master_control.installations
     ADD COLUMN IF NOT EXISTS revoked_at timestamp,
     ADD COLUMN IF NOT EXISTS revoked_reason text`,
  `CREATE TABLE IF NOT EXISTS master_control.release_deployments (
     id serial PRIMARY KEY,
     release_id integer NOT NULL REFERENCES master_control.app_releases(id) ON DELETE CASCADE,
     installation_id integer NOT NULL REFERENCES master_control.installations(id) ON DELETE CASCADE,
     status text NOT NULL DEFAULT 'offered', error text,
     offered_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS release_deployments_unique_idx ON master_control.release_deployments (release_id, installation_id)`,
  `CREATE INDEX IF NOT EXISTS release_deployments_release_idx ON master_control.release_deployments (release_id)`,
  `CREATE TABLE IF NOT EXISTS master_control.installation_commands (
     id serial PRIMARY KEY,
     installation_id integer NOT NULL REFERENCES master_control.installations(id) ON DELETE CASCADE,
     type text NOT NULL, status text NOT NULL DEFAULT 'queued',
     requested_by integer REFERENCES master_control.master_admins(id) ON DELETE SET NULL,
     requested_at timestamp NOT NULL DEFAULT now(), delivered_at timestamp, completed_at timestamp, result text)`,
  `CREATE INDEX IF NOT EXISTS installation_commands_installation_idx ON master_control.installation_commands (installation_id, status)`,

  // ---- more admin roles
  `ALTER TYPE master_control.master_admin_role ADD VALUE IF NOT EXISTS 'platform_ops'`,
  `ALTER TYPE master_control.master_admin_role ADD VALUE IF NOT EXISTS 'release_manager'`,
  `ALTER TYPE master_control.master_admin_role ADD VALUE IF NOT EXISTS 'auditor'`,

  // ---- incidents
  `CREATE TABLE IF NOT EXISTS master_control.incidents (
     id serial PRIMARY KEY,
     fingerprint text NOT NULL, title text NOT NULL, module text,
     severity master_control.error_severity NOT NULL DEFAULT 'error',
     status text NOT NULL DEFAULT 'new',
     assigned_admin_id integer REFERENCES master_control.master_admins(id) ON DELETE SET NULL,
     occurrences integer NOT NULL DEFAULT 1,
     first_seen_at timestamp NOT NULL DEFAULT now(), last_seen_at timestamp NOT NULL DEFAULT now(),
     last_app_version text, acknowledged_at timestamp, resolved_at timestamp, resolution_notes text,
     created_at timestamp NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS incidents_fingerprint_idx ON master_control.incidents (fingerprint)`,
  `CREATE INDEX IF NOT EXISTS incidents_status_idx ON master_control.incidents (status)`,
  `CREATE INDEX IF NOT EXISTS incidents_last_seen_idx ON master_control.incidents (last_seen_at)`,
  `CREATE TABLE IF NOT EXISTS master_control.incident_events (
     id serial PRIMARY KEY,
     incident_id integer NOT NULL REFERENCES master_control.incidents(id) ON DELETE CASCADE,
     kind text NOT NULL,
     admin_id integer REFERENCES master_control.master_admins(id) ON DELETE SET NULL,
     admin_name text, note text, created_at timestamp NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON master_control.incident_events (incident_id)`,
  `CREATE TABLE IF NOT EXISTS master_control.incident_days (
     incident_id integer NOT NULL REFERENCES master_control.incidents(id) ON DELETE CASCADE,
     day date NOT NULL, count integer NOT NULL DEFAULT 0,
     PRIMARY KEY (incident_id, day))`,
  `ALTER TABLE IF EXISTS master_control.installation_errors ADD COLUMN IF NOT EXISTS incident_id integer`,
  `CREATE INDEX IF NOT EXISTS installation_errors_incident_idx ON master_control.installation_errors (incident_id)`,

  // ---- audit log: richer columns
  `ALTER TABLE IF EXISTS master_control.master_audit_logs
     ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success',
     ADD COLUMN IF NOT EXISTS reason text,
     ADD COLUMN IF NOT EXISTS customer_id integer,
     ADD COLUMN IF NOT EXISTS installation_id integer,
     ADD COLUMN IF NOT EXISTS correlation_id text,
     ADD COLUMN IF NOT EXISTS actor_name text,
     ADD COLUMN IF NOT EXISTS actor_email text,
     ADD COLUMN IF NOT EXISTS ip text`,
  `CREATE INDEX IF NOT EXISTS master_audit_logs_action_idx ON master_control.master_audit_logs (action)`,
  `CREATE INDEX IF NOT EXISTS master_audit_logs_admin_idx ON master_control.master_audit_logs (admin_id)`,
  `CREATE INDEX IF NOT EXISTS master_audit_logs_customer_idx ON master_control.master_audit_logs (customer_id)`,
  `CREATE INDEX IF NOT EXISTS master_audit_logs_installation_idx ON master_control.master_audit_logs (installation_id)`,

  // ---- audit log is append-only: the database itself refuses edits and deletes
  //      (the only allowed UPDATE is the foreign key clearing admin_id when an account is removed)
  `CREATE OR REPLACE FUNCTION master_control.audit_logs_immutable() RETURNS trigger AS $$
   BEGIN
     IF TG_OP = 'UPDATE' AND NEW.admin_id IS NULL AND OLD.admin_id IS NOT NULL
        AND NEW.action = OLD.action AND NEW.description = OLD.description AND NEW.created_at = OLD.created_at THEN
       RETURN NEW;
     END IF;
     RAISE EXCEPTION 'The audit log is append-only';
   END $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS audit_logs_immutable ON master_control.master_audit_logs`,
  `CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON master_control.master_audit_logs
     FOR EACH ROW EXECUTE FUNCTION master_control.audit_logs_immutable()`,
  `DROP TRIGGER IF EXISTS audit_logs_no_truncate ON master_control.master_audit_logs`,
  `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON master_control.master_audit_logs
     FOR EACH STATEMENT EXECUTE FUNCTION master_control.audit_logs_immutable()`,

  // ---- platform settings
  `CREATE TABLE IF NOT EXISTS master_control.platform_settings (
     key text PRIMARY KEY, value text NOT NULL,
     updated_by integer REFERENCES master_control.master_admins(id) ON DELETE SET NULL,
     updated_at timestamp NOT NULL DEFAULT now())`,
];

/**
 * Brings an existing Master database up to date with everything the code expects. Every statement
 * is idempotent and independent (one failing doesn't stop the rest), so it's safe on every start -
 * an update never leaves the dashboard broken just because `db:push` couldn't reach the database.
 */
export async function ensureMasterColumns(): Promise<void> {
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error(`[master-db] self-heal step skipped (${sql.trim().slice(0, 60).replace(/\s+/g, " ")}…):`, describeDbError(err));
    }
  }
}
