// src/server.ts (or server.js if not using TS)
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { leadsRouter } from "./routes/leads.js";
import { leadsKanbanRouter } from "./routes/leads.kanban.js";
import { leadsStageRouter } from "./routes/leads.stage.js";
import { leadsReportsRouter } from "./routes/leads.reports.js";
import { requireAuth } from "./util/requireAuth.js";
import { setTenant } from "./mw/setTenant.js";

import { pool } from "./db.js";

// -------- App bootstrap --------
const app = express();

// Trust Render/Cloudflare proxy so Secure cookies (SameSite=None) work
app.set("trust proxy", 1);

// Body & cookies (do this once)
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// CORS (allow credentials; supports comma-separated CORS_ORIGIN)
const parseOrigins = (raw?: string) =>
  (raw ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

const allowedOrigins =
  parseOrigins(process.env.CORS_ORIGIN) || ["http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Tenant context
app.use(setTenant);

// -------- Diagnostics & health --------

// Simple health checks (both /health and /healthz)
app.get("/health", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// API root + health JSON
app.get("/api", (_req, res) => {
  res.status(200).json({
    ok: true,
    version: process.env.GIT_COMMIT || "unknown",
    service: "genius-backend",
  });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// DB ping (two aliases)
const dbPingHandler = async (_req: any, res: any) => {
  try {
    const r = await pool.query("select 1 as one");
    res.json({ ok: true, db: r.rows[0] });
  } catch (e: any) {
    console.error("[DB PING] ERROR:", e);
    res.status(500).json({ ok: false, error: e?.message || "db error" });
  }
};
app.get("/api/db/ping", dbPingHandler);
app.get("/api/debug/db", dbPingHandler);

// Quick sample user read (optional schema check)
app.get("/api/debug/user", async (_req, res) => {
  try {
    const r = await pool.query("select id, email from app_user limit 1");
    res.json({ ok: true, sample: r.rows });
  } catch (e: any) {
    console.error("[DEBUG /api/debug/user] ERROR:", e);
    res.status(500).json({ ok: false, error: e?.message || "query failed" });
  }
});

// Root
app.get("/", (_req, res) =>
  res.status(200).json({
    service: "genius-backend",
    ok: true,
    time: new Date().toISOString(),
  })
);

// -------- API routes --------
app.use("/api/auth", authRouter); // public
app.use("/api/me", requireAuth, meRouter);
app.use("/api/leads/kanban", requireAuth, leadsKanbanRouter);
app.use("/api/leads/reports", requireAuth, leadsReportsRouter);
// Keep stage + general leads under /api/leads
app.use("/api/leads", requireAuth, leadsStageRouter);
app.use("/api/leads", requireAuth, leadsRouter);

// -------- 404 & errors --------
app.use((req, res) => {
  res
    .status(404)
    .json({ error: "Not Found", method: req.method, path: req.originalUrl });
});

// Central error handler (keep types loose to avoid TS v5/v4 mismatch)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: err?.message || "Internal Server Error",
    ...(process.env.DEBUG === "1" ? { stack: err?.stack } : {}),
  });
});

// -------- Listen --------
const PORT = Number(process.env.PORT) || 3000;
// Bind to 0.0.0.0 so Render can reach the process
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ API listening on :${PORT}`);
});

export default app;
