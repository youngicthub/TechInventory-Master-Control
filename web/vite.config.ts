import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const isVercel = process.env.VERCEL === "1";

if (isVercel && !process.env.VITE_MASTER_API_URL) {
  throw new Error("Set VITE_MASTER_API_URL to the public Master API URL before deploying the dashboard to Vercel.");
}

// Standalone Vite app for the Master App dashboard - deliberately kept
// separate from Frontend/app's config (own port, own env vars, no
// required PORT/BASE_PATH like the main app has) since this is a
// completely different project that happens to live in the same repo.
export default defineConfig(({ command }) => ({
  // Built dashboard is served by the Master API under /console/ (see api/src/app.ts).
  // Vercel hosts the dashboard at the site root instead.
  base: command === "build" && !isVercel ? "/console/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 4200,
    host: "0.0.0.0",
  },
  preview: {
    port: Number(process.env.PORT) || 4200,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
