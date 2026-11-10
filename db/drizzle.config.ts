import { defineConfig } from "drizzle-kit";
import path from "path";

// Deliberately a DIFFERENT env var name from the main app's DATABASE_URL,
// even though it's fine for both to point at the exact same connection
// string (see schema/pg-schema.ts - every table here lives in its own
// "master_control" Postgres schema, so there's no collision with the
// main app's "public" schema tables). The separate name just makes it
// obvious, in .env, which value is doing which job.
if (!process.env.MASTER_DATABASE_URL) {
  throw new Error(
    "MASTER_DATABASE_URL must be set - see MasterControl/.env.example.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  schemaFilter: ["master_control"],
  dbCredentials: {
    url: process.env.MASTER_DATABASE_URL,
  },
});
