"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsKanbanRouter = void 0;
const express_1 = require("express");
const db_js_1 = require("../db.js");
const requirePermission_js_1 = require("../util/requirePermission.js");
exports.leadsKanbanRouter = (0, express_1.Router)();
exports.leadsKanbanRouter.get("/", (0, requirePermission_js_1.requirePermission)("leads:read"), async (req, res) => {
    const pipelineId = req.query.pipeline_id;
    const { rows: stages } = await db_js_1.pool.query(`
    WITH p AS (
      SELECT id FROM pipeline
      WHERE ($1::uuid IS NOT NULL AND id=$1)
      OR ($1::uuid IS NULL)
      ORDER BY created_at ASC
      LIMIT 1
    )
    SELECT s.id, s.key, s.name, s.sort_order
    FROM pipeline_stage s
    JOIN p ON s.pipeline_id = p.id
    ORDER BY s.sort_order ASC, s.created_at ASC
    `, [pipelineId || null]);
    if (!stages.length)
        return res.json({ stages: [], columns: {} });
    const { rows: leads } = await db_js_1.pool.query(`
    SELECT id, name, primary_email, primary_phone, status, probability, estimated_value, stage_id
    FROM lead
    WHERE pipeline_id = (SELECT id FROM pipeline ORDER BY created_at ASC LIMIT 1)
       OR ($1::uuid IS NOT NULL AND pipeline_id=$1)
    ORDER BY updated_at DESC
    `, [pipelineId || null]);
    const columns = {};
    stages.forEach((s) => { columns[s.id] = []; });
    leads.forEach(l => { if (columns[l.stage_id])
        columns[l.stage_id].push(l); });
    res.json({ stages, columns });
});
