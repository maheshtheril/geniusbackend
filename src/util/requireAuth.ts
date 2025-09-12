import { Request, Response, NextFunction } from "express";
import { pool } from "../db.js";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sid = (req as any).cookies?.sid;
  if (!sid) return res.status(401).json({ error: "Unauthenticated" });

  const { rows } = await pool.query(`
    with u as (
      select u.id as user_id, u.email, u.name, u.tenant_id
      from app_user u
      join sessions s on s.user_id=u.id and s.sid=$1
      limit 1
    ), ur as (
      select r.key, r.name, r.permissions
      from user_role x
      join role r on r.id = x.role_id
      join u on true
      where x.user_id = u.user_id
    )
    select (select row_to_json(u) from u) as user,
           jsonb_agg(ur.permissions)::jsonb as permissions_arrays,
           jsonb_agg(ur.key) as role_keys
  `, [sid]);

  const row = rows[0];
  if (!row?.user) return res.status(401).json({ error: "Session expired" });

  const perms = new Set<string>();
  (row.permissions_arrays || []).flat().forEach((p: string) => perms.add(p));

  (req as any).auth = {
    user: row.user,
    tenantId: row.user.tenant_id,
    roles: row.role_keys || [],
    permissions: [...perms]
  };
  next();
}
