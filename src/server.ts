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

import { pool } from "./db.js"; // top of file if not already



const app = express();
app.use(express.json({ limit: "1mb" }));   // <-- REQUIRED
app.use(cookieParser());                   
// Trust Render's proxy so Secure cookies (SameSite=None) work
app.set("trust proxy", 1);

// CORS (allow credentials)
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
    credentials: true,
  })
);



// Body & cookies
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Tenant context
app.use(setTenant);

app.get("/api/debug/db", async (_req, res) => {
  try {
    const r = await pool.query("select 1 as ok");
    res.json({ ok: true, result: r.rows[0] });
  } catch (e: any) {
    console.error("[DEBUG /api/debug/db] ERROR:", e);
    res.status(500).json({ ok: false, error: e?.message || "db failed" });
  }
});

// Try reading your users table to confirm schema
app.get("/api/debug/user", async (_req, res) => {
  try {
    const r = await pool.query("select id, email from app_user limit 1");
    res.json({ ok: true, sample: r.rows });
  } catch (e: any) {
    console.error("[DEBUG /api/debug/user] ERROR:", e);
    res.status(500).json({ ok: false, error: e?.message || "query failed" });
  }
});


app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---- Health & root (fixes "Cannot GET /") ----
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) =>
  res.status(200).json({
    service: "genius-backend",
    ok: true,
    time: new Date().toISOString(),
  })
);

// ---- API routes ----
app.use("/api/auth", authRouter);
app.use("/api/me", requireAuth, meRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/api/leads/kanban", requireAuth, leadsKanbanRouter);
app.use("/api/leads/reports", requireAuth, leadsReportsRouter);
app.use("/api/leads", requireAuth, leadsStageRouter); // patch stage

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
});

// Central error handler
app.use((err, _req, res, _next) => {
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: err?.message || "Internal Server Error",
    ...(process.env.DEBUG === "1" ? { stack: err?.stack } : {}),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), "0.0.0.0", () => console.log(`API on :${PORT}`));

export default app;
