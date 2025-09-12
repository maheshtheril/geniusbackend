import { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

// @ts-nocheck
// Minimal, type-agnostic auth guard for production build

export function requireAuth(req: any, res: any, next: any) {
  try {
    // Your app may attach user via session/jwt middleware
    const user = (req as any).user || (req as any).session?.user;
    if (!user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Avoid calling a shadowed "Number" identifier — use parseInt / unary plus instead
    const tenantHeader = req.headers['x-tenant-id'] ?? req.headers['x-tenant'] ?? req.query?.tenant_id ?? req.body?.tenant_id;
    const companyHeader = req.headers['x-company-id'] ?? req.query?.company_id ?? req.body?.company_id;

    const tenant_id = tenantHeader ? String(tenantHeader) : null;
    const company_id = companyHeader != null && companyHeader !== '' ? parseInt(String(companyHeader), 10) : null;

    (req as any).tenant_id = tenant_id;
    (req as any).company_id = company_id;

    return next();
  } catch (_e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

