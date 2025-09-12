import { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

export async function setTenant(req: Request, _res: Response, next: NextFunction) {
  const sid = (req as any).cookies?.sid;
  if (!sid) return next();

  const { rows } = await pool.query(
    `select s.tenant_id from sessions s where s.sid=$1 limit 1`, [sid]
  );
  const tenantId = rows[0]?.tenant_id || null;
  if (tenantId) {
    await pool.query(`select public.fn_set_tenant($1::uuid)`, [tenantId]);
    (req as any).tenantId = tenantId;
  }
  next();
}
