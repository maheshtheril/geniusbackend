"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meRouter = void 0;
const express_1 = require("express");
exports.meRouter = (0, express_1.Router)();
exports.meRouter.get("/", async (req, res) => {
    const { user, permissions, roles } = req.auth;
    const canLeads = permissions.includes('*') || permissions.some((p) => p.startsWith('leads:'));
    const sidebar = [];
    if (canLeads) {
        sidebar.push({ key: "leads", label: "Leads", path: "/leads" }, { key: "pipelines", label: "Pipelines", path: "/leads/pipelines" }, { key: "sources", label: "Sources", path: "/leads/sources" }, { key: "import", label: "Import", path: "/leads/import" }, { key: "duplicates", label: "Duplicates", path: "/leads/duplicates" }, { key: "templates", label: "Templates", path: "/leads/templates" }, { key: "reports", label: "Reports", path: "/leads/reports" }, { key: "ai", label: "AI Assistant", path: "/leads/ai" });
    }
    res.json({
        user, roles, permissions,
        dashboards: {
            default: (roles === null || roles === void 0 ? void 0 : roles.includes("global_super_admin")) ? "/dash/global"
                : (roles === null || roles === void 0 ? void 0 : roles.includes("tenant_super_admin")) ? "/dash/tenant"
                    : "/dash/sales"
        },
        sidebar
    });
});
