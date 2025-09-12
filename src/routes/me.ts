import { Router } from "express";

export const meRouter = Router();

meRouter.get("/", async (req: any, res) => {
  const { user, permissions, roles } = req.auth;

  const canLeads = permissions.includes('*') || permissions.some((p: string)=>p.startsWith('leads:'));
  const sidebar: any[] = [];
  if (canLeads) {
    sidebar.push(
      { key: "leads", label: "Leads", path: "/leads" },
      { key: "pipelines", label: "Pipelines", path: "/leads/pipelines" },
      { key: "sources", label: "Sources", path: "/leads/sources" },
      { key: "import", label: "Import", path: "/leads/import" },
      { key: "duplicates", label: "Duplicates", path: "/leads/duplicates" },
      { key: "templates", label: "Templates", path: "/leads/templates" },
      { key: "reports", label: "Reports", path: "/leads/reports" },
      { key: "ai", label: "AI Assistant", path: "/leads/ai" }
    );
  }

  res.json({
    user, roles, permissions,
    dashboards: {
      default: roles?.includes("global_super_admin") ? "/dash/global"
             : roles?.includes("tenant_super_admin") ? "/dash/tenant"
             : "/dash/sales"
    },
    sidebar
  });
});
