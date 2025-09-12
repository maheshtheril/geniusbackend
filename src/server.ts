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
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:5173"], credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(setTenant);

app.use("/api/auth", authRouter);
app.use("/api/me", requireAuth, meRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/api/leads/kanban", requireAuth, leadsKanbanRouter);
app.use("/api/leads/reports", requireAuth, leadsReportsRouter);
app.use("/api/leads", requireAuth, leadsStageRouter); // patch stage

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
