"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts (or server.js if not using TS)
const express_1 = __importDefault(require("express"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const auth_js_1 = require("./routes/auth.js");
const me_js_1 = require("./routes/me.js");
const leads_js_1 = require("./routes/leads.js");
const leads_kanban_js_1 = require("./routes/leads.kanban.js");
const leads_stage_js_1 = require("./routes/leads.stage.js");
const leads_reports_js_1 = require("./routes/leads.reports.js");
const requireAuth_js_1 = require("./util/requireAuth.js");
const setTenant_js_1 = require("./mw/setTenant.js");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "1mb" })); // <-- REQUIRED
app.use((0, cookie_parser_1.default)());
// Trust Render's proxy so Secure cookies (SameSite=None) work
app.set("trust proxy", 1);
// CORS (allow credentials)
app.use((0, cors_1.default)({
    origin: ((_a = process.env.CORS_ORIGIN) === null || _a === void 0 ? void 0 : _a.split(",")) || ["http://localhost:5173"],
    credentials: true,
}));
// Body & cookies
app.use(express_1.default.json({ limit: "2mb" }));
app.use((0, cookie_parser_1.default)());
// Tenant context
app.use(setTenant_js_1.setTenant);
app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
});
// ---- Health & root (fixes "Cannot GET /") ----
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/", (_req, res) => res.status(200).json({
    service: "genius-backend",
    ok: true,
    time: new Date().toISOString(),
}));
// ---- API routes ----
app.use("/api/auth", auth_js_1.authRouter);
app.use("/api/me", requireAuth_js_1.requireAuth, me_js_1.meRouter);
app.use("/api/leads", requireAuth_js_1.requireAuth, leads_js_1.leadsRouter);
app.use("/api/leads/kanban", requireAuth_js_1.requireAuth, leads_kanban_js_1.leadsKanbanRouter);
app.use("/api/leads/reports", requireAuth_js_1.requireAuth, leads_reports_js_1.leadsReportsRouter);
app.use("/api/leads", requireAuth_js_1.requireAuth, leads_stage_js_1.leadsStageRouter); // patch stage
// 404 for unknown routes
app.use((req, res) => {
    res.status(404).json({ error: "Not Found", path: req.originalUrl });
});
// Central error handler
app.use((err, _req, res, _next) => {
    const status = (err === null || err === void 0 ? void 0 : err.status) || (err === null || err === void 0 ? void 0 : err.statusCode) || 500;
    res.status(status).json({
        error: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        ...(process.env.DEBUG === "1" ? { stack: err === null || err === void 0 ? void 0 : err.stack } : {}),
    });
});
const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), "0.0.0.0", () => console.log(`API on :${PORT}`));
exports.default = app;
