import { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

// @ts-nocheck
export function setTenant(req: any, _res: any, next: any) {
  const tenantHeader = req.headers['x-tenant-id'] ?? req.headers['x-tenant'] ?? req.query?.tenant_id ?? req.body?.tenant_id;
  (req as any).tenant_id = tenantHeader ? String(tenantHeader) : null;
  next();
}

