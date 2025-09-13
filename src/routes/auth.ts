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
  const { rows } = await pool.query(
    `SELECT id FROM tenant WHERE slug = $1 LIMIT 1`,
    [tenantSlug]
  );
  return rows[0]?.id ?? null;
}

/* ------------------------- Table introspection utils ------------------------ */

type ColSet = Set<string>;
const tableColsCache: Record<string, ColSet> = {};

async function getTableCols(table: string): Promise<ColSet> {
  if (tableColsCache[table]) return tableColsCache[table];
  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [table]
  );
  const set = new Set<string>(rows.map((r: any) => r.column_name));
  tableColsCache[table] = set;
  return set;
}

/* -------------------------- Smart insert helpers ---------------------------- */

async function insertSession(params: {
  sid: string;
  user_id: string;
  tenant_id: string | null;
  device: string | null;
  absolute_expiry: Date;
}) {
  const cols = await getTableCols("sessions");

  const names: string[] = [];
  const values: any[] = [];
  let i = 1;

  // required knowns (at least sid, user_id, absolute_expiry exist in your schema)
  if (cols.has("sid")) { names.push("sid"); values.push(params.sid); }
  if (cols.has("user_id")) { names.push("user_id"); values.push(params.user_id); }
  if (cols.has("tenant_id")) { names.push("tenant_id"); values.push(params.tenant_id); }
  if (cols.has("device")) { names.push("device"); values.push(params.device); }
  if (cols.has("absolute_expiry")) { names.push("absolute_expiry"); values.push(params.absolute_expiry); }
  if (cols.has("created_at")) { names.push("created_at"); values.push(new Date()); }

  if (!names.length) throw new Error("sessions table has no expected columns");

  const placeholders = names.map(() => `$${i++}`);
  const sql = `INSERT INTO sessions (${names.join(",")}) VALUES (${placeholders.join(",")})`;
  await pool.query(sql, values);
}

async function insertRefreshToken(params: {
  rid: string;
  sid: string;
  user_id: string;
  tenant_id: string | null;
  token_hash: string;
  expires_at: Date;
}) {
  const cols = await getTableCols("refresh_tokens");

  const names: string[] = [];
  const values: any[] = [];
  let i = 1;

  // common fields
  if (cols.has("rid")) { names.push("rid"); values.push(params.rid); }
  if (cols.has("sid")) { names.push("sid"); values.push(params.sid); }
  if (cols.has("user_id")) { names.push("user_id"); values.push(params.user_id); }
  if (cols.has("tenant_id")) { names.push("tenant_id"); values.push(params.tenant_id); }
  if (cols.has("token_hash")) { names.push("token_hash"); values.push(params.token_hash); }
  if (cols.has("replaced_by_token_hash")) { names.push("replaced_by_token_hash"); values.push(null); }
  if (cols.has("revoked")) { names.push("revoked"); values.push(false); }
  if (cols.has("created_at")) { names.push("created_at"); values.push(new Date()); }
  if (cols.has("expires_at")) { names.push("expires_at"); values.push(params.expires_at); }

  if (!names.length) throw new Error("refresh_tokens table has no expected columns");

  const placeholders = names.map(() => `$${i++}`);
  const sql = `INSERT INTO refresh_tokens (${names.join(",")}) VALUES (${placeholders.join(",")})`;
  await pool.query(sql, values);
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

    // Optional tenant scoping
    const tenantIdFromSlug = await findTenantIdBySlug(tenantSlug);
    if (tenantSlug && !tenantIdFromSlug) {
      return res.status(400).json({ error: "Invalid tenant" });
    }

    // User fetch (tolerate password vs password_hash, missing is_active)
    const { rows } = await pool.query(
      `
      SELECT
        id,
        email,
        COALESCE(password, password_hash) AS password,
        tenant_id,
        COALESCE(is_active, true) AS is_active
      FROM app_user
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (tenantIdFromSlug && user.tenant_id && user.tenant_id !== tenantIdFromSlug) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Create session + refresh token
    const sid = uuid();
    const rid = uuid();
    const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");
    const effectiveTenantId = user.tenant_id ?? tenantIdFromSlug ?? null;

    // If your schema requires tenant_id NOT NULL, enforce:
    // if (!effectiveTenantId) return res.status(400).json({ error: "Tenant not resolved for user" });

    await insertSession({
      sid,
      user_id: user.id,
      tenant_id: effectiveTenantId,
      device: (req.headers["user-agent"] as string) || null,
      absolute_expiry: dayjs().add(8, "hours").toDate(),
    });

    await insertRefreshToken({
      rid,
      sid,
      user_id: user.id,
      tenant_id: effectiveTenantId,
      token_hash: tokenHash,
      expires_at: dayjs().add(30, "days").toDate(),
    });

    setSessionCookies(res, sid, rid);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[AUTH /login] ERROR:", err);
    if (process.env.DEBUG === "1") {
      return res.status(500).json({ error: "Login failed", detail: String(err?.message || err) });
    }
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
