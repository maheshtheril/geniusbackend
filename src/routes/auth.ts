// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

/* ------------------------------ Cookie helpers ----------------------------- */

function makeCookieOptions() {
  // If frontend is on a DIFFERENT origin (Render FE + Render BE), we must use:
  // SameSite='none' and secure=true. If same-origin, you can change to lax.
  const crossSite = true; // set to false if same-origin
  const opts: any = {
    httpOnly: true,
    sameSite: crossSite ? "none" : "lax",
    secure: true,
    path: "/",
  };
  if (process.env.COOKIE_DOMAIN) {
    opts.domain = process.env.COOKIE_DOMAIN;
  }
  return opts;
}

function setSessionCookies(res: any, sid: string, rid: string) {
  const opts = makeCookieOptions();
  res.cookie("sid", sid, opts);
  res.cookie("rid", rid, opts);
}

function clearSessionCookies(res: any) {
  const opts = makeCookieOptions();
  res.clearCookie("sid", opts);
  res.clearCookie("rid", opts);
}

/* ------------------------------ Tenant helpers ----------------------------- */

async function findTenantIdBySlug(tenantSlug?: string | null): Promise<string | null> {
  if (!tenantSlug) return null;
  const { rows } = await pool.query(`SELECT id FROM tenant WHERE slug = $1 LIMIT 1`, [tenantSlug]);
  return rows[0]?.id ?? null;
}

/* ---------------------------------- Routes --------------------------------- */

/**
 * POST /api/auth/login
 * Body: { email, password, tenantSlug? }
 */
authRouter.post("/login", async (req: any, res: any) => {
  try {
    const { email, password, tenantSlug } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Optional tenant scoping (only if provided)
    const tenantIdFromSlug = await findTenantIdBySlug(tenantSlug);
    if (tenantSlug && !tenantIdFromSlug) {
      return res.status(400).json({ error: "Invalid tenant" });
    }

    // Load user (active only). NOTE: expecting column name "password".
    // If your schema uses "password_hash", change it below to that column name.
    const { rows } = await pool.query(
      `SELECT id, email, password, tenant_id, is_active
       FROM app_user
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // If tenantSlug provided, optionally ensure user's tenant matches
    if (tenantIdFromSlug && user.tenant_id && user.tenant_id !== tenantIdFromSlug) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const hash = user.password || "";
    const ok = hash ? await bcrypt.compare(password, hash) : false;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Create session + refresh token
    const sid = uuid();
    const rid = uuid();
    const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");
    const effectiveTenantId = user.tenant_id ?? tenantIdFromSlug ?? null;

    // 8h absolute session expiry
    await pool.query(
      `INSERT INTO sessions (sid, user_id, tenant_id, device, absolute_expiry)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sid,
        user.id,
        effectiveTenantId,
        req.headers["user-agent"] || null,
        dayjs().add(8, "hours").toDate(),
      ]
    );

    // 30d refresh token
    await pool.query(
      `INSERT INTO refresh_tokens (rid, sid, user_id, tenant_id, token_hash, revoked, expires_at)
       VALUES ($1, $2, $3, $4, $5, false, $6)`,
      [rid, sid, user.id, effectiveTenantId, tokenHash, dayjs().add(30, "days").toDate()]
    );

    setSessionCookies(res, sid, rid);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[AUTH /login] ERROR:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/logout
 * - Revokes refresh token and deletes session (if present).
 * - Always clears cookies.
 */
authRouter.post("/logout", async (req: any, res: any) => {
  try {
    const rid = req?.cookies?.rid as string | undefined;
    const sid = req?.cookies?.sid as string | undefined;

    if (rid) {
      await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE rid = $1`, [rid]);
    }
    if (sid) {
      await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
    }
  } catch (err: any) {
    console.error("[AUTH /logout] ERROR:", err);
    // proceed to cookie clear anyway
  } finally {
    clearSessionCookies(res);
  }
  return res.json({ ok: true });
});

/**
 * GET /api/auth/status
 * - Validates sid cookie against sessions + expiry; returns minimal user info.
 */
authRouter.get("/status", async (req: any, res: any) => {
  try {
    const sid = req?.cookies?.sid as string | undefined;
    if (!sid) {
      return res.json({ ok: true, authenticated: false });
    }

    const { rows } = await pool.query(
      `
      SELECT s.sid,
             s.user_id,
             s.tenant_id,
             s.absolute_expiry,
             u.email,
             u.full_name,
             u.role
      FROM sessions s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.sid = $1
      LIMIT 1
      `,
      [sid]
    );

    const sess = rows[0];
    if (!sess) {
      clearSessionCookies(res);
      return res.json({ ok: true, authenticated: false });
    }

    const expired = dayjs(sess.absolute_expiry).isBefore(dayjs());
    if (expired) {
      await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
      clearSessionCookies(res);
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
