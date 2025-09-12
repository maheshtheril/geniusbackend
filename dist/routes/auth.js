"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_js_1 = require("../db.js");
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const dayjs_1 = __importDefault(require("dayjs"));
exports.authRouter = (0, express_1.Router)();
function setCookies(res, sid, rid) {
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    res.cookie("rid", rid, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
}
exports.authRouter.post("/login", async (req, res) => {
    var _a;
    const { email, password, tenantSlug } = req.body;
    const { rows: trows } = await db_js_1.pool.query(`select id from tenant where ($1::text is null) or slug=$1 limit 1`, [tenantSlug || null]);
    const tenantId = ((_a = trows[0]) === null || _a === void 0 ? void 0 : _a.id) || null;
    const { rows } = await db_js_1.pool.query(`select id, password, tenant_id from app_user where email=$1 and is_active=true limit 1`, [email]);
    const user = rows[0];
    if (!user)
        return res.status(401).json({ error: "Invalid credentials" });
    const ok = user.password && await bcryptjs_1.default.compare(password, user.password);
    if (!ok)
        return res.status(401).json({ error: "Invalid credentials" });
    const sid = (0, uuid_1.v4)();
    const rid = (0, uuid_1.v4)();
    const tokenHash = crypto_1.default.createHash("sha256").update(rid).digest("hex");
    await db_js_1.pool.query(`insert into sessions (sid, user_id, tenant_id, device, absolute_expiry)
     values ($1,$2,$3,$4,$5)`, [sid, user.id, user.tenant_id, req.headers["user-agent"] || null, (0, dayjs_1.default)().add(8, "hours").toDate()]);
    await db_js_1.pool.query(`insert into refresh_tokens (rid, sid, user_id, tenant_id, token_hash, revoked, expires_at)
     values ($1,$2,$3,$4,$5,false,$6)`, [rid, sid, user.id, user.tenant_id, tokenHash, (0, dayjs_1.default)().add(30, "days").toDate()]);
    setCookies(res, sid, rid);
    res.json({ ok: true });
});
exports.authRouter.post("/logout", async (req, res) => {
    var _a, _b;
    const rid = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a.rid;
    const sid = (_b = req.cookies) === null || _b === void 0 ? void 0 : _b.sid;
    if (rid)
        await db_js_1.pool.query(`update refresh_tokens set revoked=true where rid=$1`, [rid]);
    if (sid)
        await db_js_1.pool.query(`delete from sessions where sid=$1`, [sid]);
    res.clearCookie("sid");
    res.clearCookie("rid");
    res.json({ ok: true });
});
