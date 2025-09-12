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

const app = express();

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
