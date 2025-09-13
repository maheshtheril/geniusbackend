// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

/* ------------------------------ cookie helpers ----------------------------- */
function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "none" as const,
    secure: true,
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

/* ------------------------------- bootstrap --------------------------------- */
/** Create minimal schema if missing (safe to run multiple times). */
let bootstrapped = false;
async function bootstrapDbOnce() {
  if (bootstrapped) return;
  // extension + tables (no FK on tenant to avoid extra dependencies)
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email       text UNIQUE NOT NULL,
      password    text NOT NULL,
      tenant_id   uuid NULL,
      full_name   text,
      role        text,
      is_active   boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid             text PRIMARY KEY,
      user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      tenant_id       uuid NULL,
      device          text,
      absolute_expiry timestamptz NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
  `);

  /* Columns you listed earlier for refresh_tokens */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      rid                     text PRIMARY KEY,
      sid                     text NOT NULL REFERENCES sessions(sid) ON DELETE CASCADE,
      user_id                 uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      tenant_id               uuid NULL,
      token_hash              text NOT NULL,
      replaced_by_token_hash  text NULL,
      revoked                 boolean NOT NULL DEFAULT false,
      created_at              timestamptz NOT NULL DEFAULT now(),
      expires_at              timestamptz NOT NULL
    );
  `);

  bootstrapped = true;
}

/** Ensure the login email exists; if not, create with the given password (bcrypt). */
async function ensureUser(email: string, plainPassword: string) {
  const { rows } = await pool.query(
    `SELECT id, password, tenant_id, is_active FROM app_user WHERE email=$1 LIMIT 1`,
    [email]
  );
  if (rows[0]) return rows[0];

  const hash = await bcrypt.hash(plainPassword, 10);
  const insert = await pool.query(
    `INSERT INTO app_user (email, password, full_name, role, is_active)
     VALUES ($1,$2,'Admin','admin',true)
     RETURNING id, password, tenant_id, is_active`,
    [email, hash]
  );
  return insert.rows[0];
}

/* --------------------------------- routes ---------------------------------- */

/**
 * POST /api/auth/login
 * Body: { email, password }
 * - Bootstraps tables.
 * - Seeds user with given email on first login attempt (idempotent).
 * - Issues sid/rid cookies.
 */
authRouter.post("/login", async (req: any, res: any) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    await bootstrapDbOnce();

    // make sure user exists
    const user = await ensureUser(email, password);
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // verify password
    const ok = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // create session + refresh
    const sid = uuid();
    const rid = uuid();
    const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");
    const absoluteExpiry = dayjs().add(8, "hours").toDate();
    const refreshExpiry = dayjs().add(30, "days").toDate();

    await pool.query(
      `INSERT INTO sessions (sid, user_id, tenant_id, device, absolute_expiry, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (sid) DO NOTHING`,
      [sid, user.id, user.tenant_id ?? null, req.headers["user-agent"] || null, absoluteExpiry]
    );

    await pool.query(
      `INSERT INTO refresh_tokens (
         rid, sid, user_id, tenant_id, token_hash, replaced_by_token_hash, revoked, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,NULL,false,NOW(),$6)`,
      [rid, sid, user.id, user.tenant_id ?? null, tokenHash, refreshExpiry]
    );

    setCookies(res, sid, rid);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[AUTH /login] ERROR:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/** POST /api/auth/logout */
authRouter.post("/logout", async (req: any, res: any) => {
  try {
    const rid = req?.cookies?.rid as string | undefined;
    const sid = req?.cookies?.sid as string | undefined;
    if (rid) await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE rid = $1`, [rid]);
    if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
  } catch (e) {
    console.error("[AUTH /logout] ERROR:", (e as any)?.message);
  } finally {
    clearCookies(res);
    return res.json({ ok: true });
  }
});

/** GET /api/auth/status */
authRouter.get("/status", async (req: any, res: any) => {
  try {
    const sid = req?.cookies?.sid as string | undefined;
    if (!sid) return res.json({ ok: true, authenticated: false });

    const { rows } = await pool.query(
      `
      SELECT s.sid, s.user_id, s.tenant_id, s.absolute_expiry,
             u.email, u.full_name, u.role
      FROM sessions s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.sid = $1
      LIMIT 1
      `,
      [sid]
    );

    const sess = rows[0];
    if (!sess) return res.json({ ok: true, authenticated: false });

    if (dayjs(sess.absolute_expiry).isBefore(dayjs())) {
      await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
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
