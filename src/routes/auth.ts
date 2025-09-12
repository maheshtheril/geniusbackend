// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

function setCookies(res: any, sid: string, rid: string) {
  // For cross-site frontend (different domain), SameSite must be 'none' and secure must be true.
  // If your frontend is SAME origin (same domain), you can switch to SameSite: 'lax'.
  const cookieOpts = {
    httpOnly: true,
    sameSite: "none" as const, // <-- use 'none' when frontend is on a different origin
    secure: true,              // <-- required by browsers when SameSite='none'
    path: "/",
  };
  res.cookie("sid", sid, cookieOpts);
  res.cookie("rid", rid, cookieOpts);
}

authRouter.post("/login", async (req, res) => {
  const { email, password, tenantSlug } = req.body;

  // Optional tenant scoping (kept from your code)
  const { rows: trows } = await pool.query(
    `select id from tenant where ($1::text is null) or slug=$1 limit 1`,
    [tenantSlug || null]
  );
  const tenantId = trows[0]?.id || null; // not strictly used below, but retained

  const { rows } = await pool.query(
    `select id, password, tenant_id from app_user where email=$1 and is_active=true limit 1`,
    [email]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = user.password && (await bcrypt.compare(password, user.password));
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const sid = uuid();
  const rid = uuid();
  const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");

  await pool.query(
    `insert into sessions (sid, user_id, tenant_id, device, absolute_expiry)
     values ($1,$2,$3,$4,$5)`,
    [
      sid,
      user.id,
      user.tenant_id ?? tenantId,
      req.headers["user-agent"] || null,
      dayjs().add(8, "hours").toDate(),
    ]
  );

  await pool.query(
    `insert into refresh_tokens (rid, sid, user_id, tenant_id, token_hash, revoked, expires_at)
     values ($1,$2,$3,$4,$5,false,$6)`,
    [
      rid,
      sid,
      user.id,
      user.tenant_id ?? tenantId,
      tokenHash,
      dayjs().add(30, "days").toDate(),
    ]
  );

  setCookies(res, sid, rid);
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  const rid = (req as any).cookies?.rid;
  const sid = (req as any).cookies?.sid;
  if (rid) await pool.query(`update refresh_tokens set revoked=true where rid=$1`, [rid]);
  if (sid) await pool.query(`delete from sessions where sid=$1`, [sid]);
  res.clearCookie("sid", { path: "/" });
  res.clearCookie("rid", { path: "/" });
  res.json({ ok: true });
});

/**
 * GET /api/auth/status
 * Reports whether the caller is authenticated by validating the `sid` cookie
 * against the `sessions` table (and expiry). Returns minimal user info.
 */
authRouter.get("/status", async (req, res) => {
  try {
    const sid = (req as any).cookies?.sid as string | undefined;
    if (!sid) {
      return res.json({ ok: true, authenticated: false });
    }

    const { rows } = await pool.query(
      `
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
      `,
      [sid]
    );

    const sess = rows[0];
    if (!sess) {
      // session id not found – clear cookies to avoid ghost state
      res.clearCookie("sid", { path: "/" });
      res.clearCookie("rid", { path: "/" });
      return res.json({ ok: true, authenticated: false });
    }

    const expired = dayjs(sess.absolute_expiry).isBefore(dayjs());
    if (expired) {
      await pool.query(`delete from sessions where sid=$1`, [sid]);
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
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "status failed" });
  }
});
