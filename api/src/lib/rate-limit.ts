import type { Request, Response, NextFunction } from "express";

/**
 * Small in-memory fixed-window limiter (per client IP). No dependency on
 * purpose - this standalone service otherwise needs none for it, and a
 * single Master API process is the intended deployment. If you ever run
 * several instances behind a load balancer, swap this for a shared store.
 */
export function rateLimit(opts: { name: string; windowMs: number; max: number; message?: string }) {
  // Automated tests make many requests from one address; production leaves this unset (x1).
  const max = opts.max * (Number(process.env.MASTER_RATE_LIMIT_MULTIPLIER) || 1);
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, 60_000);
  sweep.unref(); // never keep the process alive just for cleanup

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${opts.name}:${req.ip ?? "unknown"}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: opts.message ?? `Too many requests - try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }
    next();
  };
}
