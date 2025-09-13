"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
// src/routes/auth.ts
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_js_1 = require("../db.js");
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const dayjs_1 = __importDefault(require("dayjs"));
exports.authRouter = (0, express_1.Router)();
function setCookies(res, sid, rid) {
    // For cross-site frontend (different domain), SameSite must be 'none' and secure must be true.
    // If your frontend is SAME origin (same domain), you can switch to SameSite: 'lax'.
    const cookieOpts = {
        httpOnly: true,
        sameSite: "none", // <-- use 'none' when frontend is on a different origin
        secure: true, // <-- required by browsers when SameSite='none'
        path: "/",
    };
    res.cookie("sid", sid, cookieOpts);
    res.cookie("rid", rid, cookieOpts);
}
exports.authRouter.post("/login", async (req, res) => {
    var _a, _b, _c;
    const { email, password, tenantSlug } = req.body;
    // Optional tenant scoping (kept from your code)
    const { rows: trows } = await db_js_1.pool.query(`select id from tenant where ($1::text is null) or slug=$1 limit 1`, [tenantSlug || null]);
    const tenantId = ((_a = trows[0]) === null || _a === void 0 ? void 0 : _a.id) || null; // not strictly used below, but retained
    const { rows } = await db_js_1.pool.query(`select id, password, tenant_id from app_user where email=$1 and is_active=true limit 1`, [email]);
    const user = rows[0];
    if (!user)
        return res.status(401).json({ error: "Invalid credentials" });
    const ok = user.password && (await bcryptjs_1.default.compare(password, user.password));
    if (!ok)
        return res.status(401).json({ error: "Invalid credentials" });
    const sid = (0, uuid_1.v4)();
    const rid = (0, uuid_1.v4)();
    const tokenHash = crypto_1.default.createHash("sha256").update(rid).digest("hex");
    await db_js_1.pool.query(`insert into sessions (sid, user_id, tenant_id, device, absolute_expiry)
     values ($1,$2,$3,$4,$5)`, [
        sid,
        user.id,
        (_b = user.tenant_id) !== null && _b !== void 0 ? _b : tenantId,
        req.headers["user-agent"] || null,
        (0, dayjs_1.default)().add(8, "hours").toDate(),
    ]);
    await db_js_1.pool.query(`insert into refresh_tokens (rid, sid, user_id, tenant_id, token_hash, revoked, expires_at)
     values ($1,$2,$3,$4,$5,false,$6)`, [
        rid,
        sid,
        user.id,
        (_c = user.tenant_id) !== null && _c !== void 0 ? _c : tenantId,
        tokenHash,
        (0, dayjs_1.default)().add(30, "days").toDate(),
    ]);
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
    res.clearCookie("sid", { path: "/" });
    res.clearCookie("rid", { path: "/" });
    res.json({ ok: true });
});
/**
 * GET /api/auth/status
 * Reports whether the caller is authenticated by validating the `sid` cookie
 * against the `sessions` table (and expiry). Returns minimal user info.
 */
exports.authRouter.get("/status", async (req, res) => {
    var _a;
    try {
        const sid = (_a = req.cookies) === null || _a === void 0 ? void 0 : _a.sid;
        if (!sid) {
            return res.json({ ok: true, authenticated: false });
        }
        const { rows } = await db_js_1.pool.query(`
      select s.sid,
             s.user_id,
             s.tenant_id,
             s.absolute_expiry,
             u.email,
             u.full_name,
             u.role
      from sessions s
      join app_user u on u.id = s.user_id
      where s.sid = $1
      limit 1
      `, [sid]);
        const sess = rows[0];
        if (!sess) {
            // session id not found – clear cookies to avoid ghost state
            res.clearCookie("sid", { path: "/" });
            res.clearCookie("rid", { path: "/" });
            return res.json({ ok: true, authenticated: false });
        }
        const expired = (0, dayjs_1.default)(sess.absolute_expiry).isBefore((0, dayjs_1.default)());
        if (expired) {
            await db_js_1.pool.query(`delete from sessions where sid=$1`, [sid]);
            res.clearCookie("sid", { path: "/" });
            // refresh token may still exist; optionally revoke by rid if you map rid↔sid
            return res.json({ ok: true, authenticated: false });
        }
        // Slim user payload; add fields as needed
        return res.json({
            ok: true,
            authenticated: true,
            user: {
                id: sess.user_id,
                email: sess.email,
                name: sess.full_name,
                role: sess.role,
                tenant_id: sess.tenant_id,
            },
        });
    }
    catch (err) {
        return res.status(500).json({ ok: false, error: (err === null || err === void 0 ? void 0 : err.message) || "status failed" });
    }
});
