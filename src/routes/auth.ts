// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

/* ------------------------------ cookie utils ------------------------------ */
/** Cross-site cookies: SameSite=None + Secure + HttpOnly */
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "none" as const, // required for cross-site cookies
    secure: true,              // required when SameSite=None
    path: "/",
  };
}
function setCookies(res: any, sid: string, rid: string) {
  const opts = cookieOpts();
  res.cookie("sid", sid, opts);
  res.cookie("rid", rid, opts);
}
function clearCookies(res: any) {
  const opts = cookieOpts();
  res.clearCookie("sid", opts);
  res.clearCookie("rid", opts);
}

/* --------------------------------- LOGIN ---------------------------------- */
/**
 * POST /api/auth/login
 * Body: { email, password }
 */
authRouter.post("/login", async (req: any, res: any) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Case-insensitive email match; select only existing columns
    const { rows } = await pool.query(
      `SELECT id,
              email,
              password,
              tenant_id,
              COALESCE(is_active, true) AS is_active
       FROM app_user
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Create session + refresh
    const sid = uuid();
    const rid = uuid();
    const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");

    await pool.query(
      `INSERT INTO sessions (sid, user_id, tenant_id, device, absolute_expiry, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (sid) DO NOTHING`,
      [sid, user.id, user.tenant_id ?? null, req.headers["user-agent"] || null, dayjs().add(8, "hours").toDate()]
    );

    await pool.query(
      `INSERT INTO refresh_tokens (
         rid, sid, user_id, tenant_id, token_hash, replaced_by_token_hash, revoked, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,NULL,false,NOW(),$6)`,
      [rid, sid, user.id, user.tenant_id ?? null, tokenHash, dayjs().add(30, "days").toDate()]
    );

    setCookies(res, sid, rid);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[AUTH /login] ERROR:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/* -------------------------------- LOGOUT ---------------------------------- */
/**
 * POST /api/auth/logout
 * - Revokes refresh token, deletes session (best-effort), clears cookies
 */
authRouter.post("/logout", async (req: any, res: any) => {
  try {
    const rid = req?.cookies?.rid as string | undefined;
    const sid = req?.cookies?.sid as string | undefined;
    if (rid) await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE rid = $1`, [rid]);
    if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
  } catch (e: any) {
    console.error("[AUTH /logout] ERROR:", e?.message || e);
  } finally {
    clearCookies(res);
    return res.json({ ok: true });
  }
});

/* -------------------------------- STATUS ---------------------------------- */
/**
 * GET /api/auth/status
 * - Validates sid cookie against sessions + expiry; returns minimal user info.
 */
authRouter.get("/status", async (req: any, res: any) => {
  try {
    const sid = req?.cookies?.sid as string | undefined;
    if (!sid) return res.json({ ok: true, authenticated: false });

    const { rows } = await pool.query(
      `SELECT s.sid, s.user_id, s.tenant_id, s.absolute_expiry,
              u.email, u.full_name, u.role
       FROM sessions s
       JOIN app_user u ON u.id = s.user_id
       WHERE s.sid = $1
       LIMIT 1`,
      [sid]
    );

    const sess = rows[0];
    if (!sess) {
      clearCookies(res);
      return res.json({ ok: true, authenticated: false });
    }

    if (dayjs(sess.absolute_expiry).isBefore(dayjs())) {
      await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
      clearCookies(res);
      return res.json({ ok: true, authenticated: false });
    }

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
    console.error("[AUTH /status] ERROR:", err);
    return res.status(500).json({ ok: false, error: "status failed" });
  }
});
