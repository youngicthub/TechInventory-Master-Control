import type { ErrorRequestHandler } from "express";
import { describeDbError } from "@masterctl/db";

function getPgCode(err: unknown): string | undefined {
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const source = (cause ?? err) as { code?: string } | undefined;
  return source?.code;
}

function getPgMessage(err: unknown): string | undefined {
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const source = (cause ?? err) as { message?: string } | undefined;
  return source?.message;
}

/**
 * Registered last, after all routes (see app.ts) - see the identical
 * middleware in the main app's Backend/api-server for the full reasoning
 * (Express 5 auto-forwards rejected async handlers here).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const rawMessage = getPgMessage(err) ?? (err instanceof Error ? err.message : String(err));
  // Connection failures arrive as an AggregateError with an empty message - spell out the real reason.
  const message = rawMessage || describeDbError(err);
  console.error(`[master-api] ${req.method} ${req.path}:`, message);

  const pgCode = getPgCode(err);
  if (pgCode === "42P01") {
    return res.status(503).json({
      error:
        "The master control-plane database schema hasn't been created yet. " +
        "Run `npm run db:push` from MasterControl/, then try again.",
    });
  }
  if (pgCode === "42703") {
    return res.status(503).json({
      error: `The database is missing a column this version expects (${message}). Run \`npm run db:push\` from MasterControl/, then try again.`,
    });
  }

  if (res.headersSent) return;
  if (!rawMessage && err instanceof AggregateError) {
    return res.status(503).json({
      error:
        "Can't reach the database right now (it may be waking up). Wait a few seconds and try again; if it keeps happening, check this computer's internet connection.",
    });
  }
  res.status(500).json({
    error: process.env.NODE_ENV === "production" ? "Something went wrong on the server." : message,
  });
};
