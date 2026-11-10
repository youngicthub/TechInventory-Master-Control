import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

interface Ctx { correlationId: string; ip: string | null }
const store = new AsyncLocalStorage<Ctx>();

/** Gives every request a correlation id (echoed as X-Request-Id) that audit entries pick up automatically. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const id = typeof incoming === "string" && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", id);
  store.run({ correlationId: id, ip: req.ip ?? null }, next);
}

export const currentContext = (): Ctx | undefined => store.getStore();
