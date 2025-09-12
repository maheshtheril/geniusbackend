import { Router } from "express";
import { pool } from "../db.js";
import { requirePermission } from "../util/requirePermission.js";

export const leadsRouter = Router();

leadsRouter.get("/", requirePermission("leads:read"), async (req, res) => {
  const q = (req.query.q as string) || "";
  const { rows } = await pool.query(
    `select id, name, primary_email, primary_phone, stage, status, estimated_value, probability
       from lead
      where ($1='' or search_vector @@ plainto_tsquery('simple', $1))
      order by updated_at desc
      limit 100`, [q]
  );
  res.json(rows);
});

// Agentic "next action" demo
leadsRouter.post("/:id/ai/next-action", requirePermission("leads:read"), async (req: any, res) => {
  const leadId = req.params.id;
  const suggestion = {
    type: "email_followup",
    subject: "Quick follow-up on your interest",
    body: "Hi {{name}},\n\nThanks for your time. Shall we schedule a 15-min call this week?\n\n— {{owner}}"
  };
  await pool.query(
    `insert into ai_action (tenant_id, lead_id, user_id, action_type, payload, accepted, executed)
     values (current_setting('app.tenant_id', true)::uuid, $1, $2, 'next_action_suggestion', $3, false, false)`,
    [leadId, req.auth?.user?.id || null, suggestion]
  );
  res.json({ suggestion });
});
