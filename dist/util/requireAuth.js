"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const db_js_1 = require("../db.js");
async function requireAuth(req, res, next) {
    var _a;
    const sid = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a.sid;
    if (!sid)
        return res.status(401).json({ error: "Unauthenticated" });
    const { rows } = await db_js_1.pool.query(`
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
    if (!(row === null || row === void 0 ? void 0 : row.user))
        return res.status(401).json({ error: "Session expired" });
    const perms = new Set();
    (row.permissions_arrays || []).flat().forEach((p) => perms.add(p));
    req.auth = {
        user: row.user,
        tenantId: row.user.tenant_id,
        roles: row.role_keys || [],
        permissions: [...perms]
    };
    next();
}
