import { Router } from "express";
import { pool } from "../db.js";
import { requirePermission } from "../util/requirePermission.js";

export const leadsReportsRouter = Router();

leadsReportsRouter.get("/summary", requirePermission("leads:report"), async (_req, res) => {
  const { rows: byStage } = await pool.query(`
    SELECT s.name as stage, count(*)::int as count,
           sum(l.estimated_value)::numeric as value,
           avg(nullif(l.probability,0))::numeric as avg_prob
    FROM lead l
    LEFT JOIN pipeline_stage s ON s.id = l.stage_id
    GROUP BY 1
    ORDER BY 1
  `);

  const { rows: byStatus } = await pool.query(`
    SELECT status, count(*)::int as count
    FROM lead GROUP BY 1 ORDER BY 1
  `);

  res.json({ byStage, byStatus });
});
