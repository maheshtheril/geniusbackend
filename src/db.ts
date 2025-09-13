// src/db.ts
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[DB] Missing DATABASE_URL");
}

const useSSL =
  process.env.PGSSL?.toLowerCase() === "true" ||
  // Render-managed Postgres usually needs SSL in prod
  process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  // optional timeouts to avoid hanging -> 502s
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
  max: Number(process.env.PGPOOL_MAX || 10),
});

pool.on("error", (err) => {
  console.error("[DB] Pool error:", err);
});
