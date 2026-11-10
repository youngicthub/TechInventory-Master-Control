import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import fs from "fs";
import path from "path";
import router from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import { MASTER_ROOT } from "./lib/releases";
import { requestContext } from "./lib/request-context";

const app: Express = express();

// Behind a reverse proxy (Caddy/nginx) the real visitor address arrives in
// X-Forwarded-For; only trust it when the operator says a proxy is in front,
// otherwise a visitor could fake their address to dodge the rate limiter.
if (process.env.MASTER_TRUST_PROXY === "true") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(requestContext);

// Basic security headers (helmet-equivalent essentials, no extra dependency).
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});

const allowedOrigins = (process.env.MASTER_ALLOWED_ORIGINS ??
  "http://localhost:4200,http://127.0.0.1:4200,http://localhost:4300,http://127.0.0.1:4300")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  }),
);
app.use(compression());
app.use(express.json({ limit: "1mb" })); // no CSVs/images cross this API - small limit is fine and safer

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", router);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// ---- Static sites served by this same process (so one command hosts it all) ----
// Public landing page at "/", admin dashboard at "/console/". Both are plain
// static files; the dashboard needs `npm run build` in MasterControl/web first
// (during development it runs on its own at :4200 instead).
const landingDir = path.resolve(process.env.MASTER_LANDING_DIR ?? path.join(MASTER_ROOT, "..", "Landing"));
const consoleDir = path.resolve(process.env.MASTER_CONSOLE_DIR ?? path.join(MASTER_ROOT, "web", "dist"));

// Checked on every request (not just at startup), so building the dashboard while the
// server is already running takes effect immediately - no restart needed.
const consoleStatic = express.static(consoleDir, { index: "index.html" });
app.use("/console", (_req, res, next) => {
  if (!fs.existsSync(path.join(consoleDir, "index.html"))) {
    return res
      .status(503)
      .type("text/plain")
      .send(
        "The dashboard hasn't been built yet.\n\nIn a second terminal run:\n  cd MasterControl\n  npm run build --workspace=@masterctl/web\n\nthen refresh this page.",
      );
  }
  consoleStatic(_req, res, next);
});

const landingStatic = express.static(landingDir, { index: "index.html" });
app.use((req, res, next) => {
  if (!fs.existsSync(path.join(landingDir, "index.html"))) return next();
  landingStatic(req, res, next);
});

app.use(errorHandler);

export default app;
