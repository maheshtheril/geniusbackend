"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsReportsRouter = void 0;
const express_1 = require("express");
const db_js_1 = require("../db.js");
const requirePermission_js_1 = require("../util/requirePermission.js");
exports.leadsReportsRouter = (0, express_1.Router)();
exports.leadsReportsRouter.get("/summary", (0, requirePermission_js_1.requirePermission)("leads:report"), async (_req, res) => {
    const { rows: byStage } = await db_js_1.pool.query(`
    SELECT s.name as stage, count(*)::int as count,
           sum(l.estimated_value)::numeric as value,
           avg(nullif(l.probability,0))::numeric as avg_prob
    FROM lead l
    LEFT JOIN pipeline_stage s ON s.id = l.stage_id
    GROUP BY 1
    ORDER BY 1
  `);
    const { rows: byStatus } = await db_js_1.pool.query(`
    SELECT status, count(*)::int as count
    FROM lead GROUP BY 1 ORDER BY 1
  `);
    res.json({ byStage, byStatus });
});
