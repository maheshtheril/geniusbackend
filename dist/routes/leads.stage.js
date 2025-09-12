"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsStageRouter = void 0;
const express_1 = require("express");
const db_js_1 = require("../db.js");
const requirePermission_js_1 = require("../util/requirePermission.js");
exports.leadsStageRouter = (0, express_1.Router)();
exports.leadsStageRouter.patch("/:id/stage", (0, requirePermission_js_1.requirePermission)("leads:write"), async (req, res) => {
    var _a, _b;
    const id = req.params.id;
    const { to_stage_id, reason } = req.body;
    const userId = (_b = (_a = req.auth) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
    const { rows } = await db_js_1.pool.query(`UPDATE lead
       SET stage_id = $2,
           updated_at = now(),
           meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{_last_stage_reason}', to_jsonb(coalesce($3,''::text))),
           created_by = coalesce(created_by, $4),
           updated_by = $4
     WHERE id = $1
     RETURNING id, name, stage_id, pipeline_id`, [id, to_stage_id, reason || null, userId || null]);
    const row = rows[0];
    if (!row)
        return res.status(404).json({ error: "Not found" });
    const suggestion = {
        type: "stage_change_followup",
        body: `Follow up after moving to stage ${to_stage_id}`
    };
    await db_js_1.pool.query(`INSERT INTO ai_action (tenant_id, lead_id, user_id, action_type, payload, accepted, executed)
     VALUES (current_setting('app.tenant_id', true)::uuid, $1, $2, 'next_action_suggestion', $3, false, false)`, [id, userId || null, suggestion]);
    res.json({ ok: true, lead: row });
});
