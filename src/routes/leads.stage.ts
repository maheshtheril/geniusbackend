import { Router } from "express";
import { pool } from "../db.js";
import { requirePermission } from "../util/requirePermission.js";

export const leadsStageRouter = Router();

leadsStageRouter.patch("/:id/stage", requirePermission("leads:write"), async (req: any, res) => {
  const id = req.params.id;
  const { to_stage_id, reason } = req.body;
  const userId = req.auth?.user?.id;

  const { rows } = await pool.query(
    `UPDATE lead
       SET stage_id = $2,
           updated_at = now(),
           meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{_last_stage_reason}', to_jsonb(coalesce($3,''::text))),
           created_by = coalesce(created_by, $4),
           updated_by = $4
     WHERE id = $1
     RETURNING id, name, stage_id, pipeline_id`,
    [id, to_stage_id, reason || null, userId || null]
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "Not found" });

  const suggestion = {
    type: "stage_change_followup",
    body: `Follow up after moving to stage ${to_stage_id}`
  };
  await pool.query(
    `INSERT INTO ai_action (tenant_id, lead_id, user_id, action_type, payload, accepted, executed)
     VALUES (current_setting('app.tenant_id', true)::uuid, $1, $2, 'next_action_suggestion', $3, false, false)`,
    [id, userId || null, suggestion]
  );

  res.json({ ok: true, lead: row });
});
