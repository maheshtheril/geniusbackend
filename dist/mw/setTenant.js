"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTenant = setTenant;
const db_js_1 = require("../db.js");
async function setTenant(req, _res, next) {
    var _a, _b;
    const sid = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a.sid;
    if (!sid)
        return next();
    const { rows } = await db_js_1.pool.query(`select s.tenant_id from sessions s where s.sid=$1 limit 1`, [sid]);
    const tenantId = ((_b = rows[0]) === null || _b === void 0 ? void 0 : _b.tenant_id) || null;
    if (tenantId) {
        await db_js_1.pool.query(`select public.fn_set_tenant($1::uuid)`, [tenantId]);
        req.tenantId = tenantId;
    }
    next();
}
