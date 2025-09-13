// src/db.ts
import { Pool } from "pg";

// Render Postgres needs explicit TLS + SNI. ?sslmode=require is ignored by node-postgres.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    // This must match the certificate CN Render presents in ap-southeast-1:
    servername: "aws-ap-southeast-1-1-postgres.render.com",
  },
  keepAlive: true,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("❌ PG pool error:", err);
});
