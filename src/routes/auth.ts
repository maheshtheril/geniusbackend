// src/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

/* -------------------------------- debug ----------------------------------- */
authRouter.get("/__up", (_req, res) => res.json({ ok: true, router: "auth" }));
authRouter.get("/__routes", (_req: any, res: any) => {
  // Inspect registered routes on this router
  // @ts-ignore
  const stack = (authRouter as any).stack || [];
  const routes = stack
    .filter((l: any) => l.route)
    .map((l: any) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
  res.json({ ok: true, routes });
});

/* ------------------------------ cookie utils ------------------------------ */
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

/* ---------------------------- optional seeding ---------------------------- */
/**
 * POST /api/auth/seed-admin
 * Headers: X-Seed-Token: <ADMIN_SEED_TOKEN>
 * Body: { email, password }
 * Creates/normalizes tables and upserts an admin user.
 */
authRouter.post("/seed-admin", async (req: any, res: any) => {
  try {
    const token = req.header("X-Seed-Token");
    if (!token || token !== process.env.ADMIN_SEED_TOKEN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password required" });
    }

    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Ensure columns exist on older schemas
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password   text`);
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS full_name  text`);
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role       text`);
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS is_active  boolean`);
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS tenant_id  uuid`);
    await pool.query(`ALTER TABLE app_user ADD COLUMN IF NOT EXISTS created_at timestamptz`);

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

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO app_user (email, password, full_name, role, is_active, created_at)
       VALUES ($1,$2,'Admin','admin',true, NOW())
       ON CONFLICT (email) DO UPDATE
         SET password = EXCLUDED.password,
             full_name = 'Admin',
             role = 'admin',
             is_active = true`,
      [email, hash]
    );

    return res.json({ ok: true, seeded: email });
  } catch (e: any) {
    console.error("[AUTH /seed-admin] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || "seed failed" });
  }
});

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

    // tolerate either password or password_hash column
    const { rows } = await pool.query(
      `SELECT id,
              email,
              COALESCE(password, password_hash) AS password,
              tenant_id,
              COALESCE(is_active, true) AS is_active
       FROM app_user
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

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
