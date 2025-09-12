import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import dayjs from "dayjs";

export const authRouter = Router();

function setCookies(res: any, sid: string, rid: string) {
  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  res.cookie("rid", rid, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
}

authRouter.post("/login", async (req, res) => {
  const { email, password, tenantSlug } = req.body;

  const { rows: trows } = await pool.query(
    `select id from tenant where ($1::text is null) or slug=$1 limit 1`, [tenantSlug || null]
  );
  const tenantId = trows[0]?.id || null;

  const { rows } = await pool.query(
    `select id, password, tenant_id from app_user where email=$1 and is_active=true limit 1`, [email]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = user.password && await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const sid = uuid();
  const rid = uuid();
  const tokenHash = crypto.createHash("sha256").update(rid).digest("hex");

  await pool.query(
    `insert into sessions (sid, user_id, tenant_id, device, absolute_expiry)
     values ($1,$2,$3,$4,$5)`,
    [sid, user.id, user.tenant_id, req.headers["user-agent"] || null, dayjs().add(8, "hours").toDate()]
  );
  await pool.query(
    `insert into refresh_tokens (rid, sid, user_id, tenant_id, token_hash, revoked, expires_at)
     values ($1,$2,$3,$4,$5,false,$6)`,
    [rid, sid, user.id, user.tenant_id, tokenHash, dayjs().add(30, "days").toDate()]
  );

  setCookies(res, sid, rid);
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  const rid = (req as any).cookies?.rid;
  const sid = (req as any).cookies?.sid;
  if (rid) await pool.query(`update refresh_tokens set revoked=true where rid=$1`, [rid]);
  if (sid) await pool.query(`delete from sessions where sid=$1`, [sid]);
  res.clearCookie("sid"); res.clearCookie("rid");
  res.json({ ok: true });
});
