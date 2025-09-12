"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsRouter = void 0;
const express_1 = require("express");
const db_js_1 = require("../db.js");
const requirePermission_js_1 = require("../util/requirePermission.js");
exports.leadsRouter = (0, express_1.Router)();
exports.leadsRouter.get("/", (0, requirePermission_js_1.requirePermission)("leads:read"), async (req, res) => {
    const q = req.query.q || "";
    const { rows } = await db_js_1.pool.query(`select id, name, primary_email, primary_phone, stage, status, estimated_value, probability
       from lead
      where ($1='' or search_vector @@ plainto_tsquery('simple', $1))
      order by updated_at desc
      limit 100`, [q]);
    res.json(rows);
});
// Agentic "next action" demo
exports.leadsRouter.post("/:id/ai/next-action", (0, requirePermission_js_1.requirePermission)("leads:read"), async (req, res) => {
    var _a, _b;
    const leadId = req.params.id;
    const suggestion = {
        type: "email_followup",
        subject: "Quick follow-up on your interest",
        body: "Hi {{name}},\n\nThanks for your time. Shall we schedule a 15-min call this week?\n\n— {{owner}}"
    };
    await db_js_1.pool.query(`insert into ai_action (tenant_id, lead_id, user_id, action_type, payload, accepted, executed)
     values (current_setting('app.tenant_id', true)::uuid, $1, $2, 'next_action_suggestion', $3, false, false)`, [leadId, ((_b = (_a = req.auth) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) || null, suggestion]);
    res.json({ suggestion });
});
