"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
// @ts-nocheck
// Minimal, type-agnostic auth guard for production build
function requireAuth(req, res, next) {
    var _a, _b, _c, _d, _f, _g, _h, _j, _k, _l;
    try {
        // Your app may attach user via session/jwt middleware
        const user = req.user || ((_a = req.session) === null || _a === void 0 ? void 0 : _a.user);
        if (!(user === null || user === void 0 ? void 0 : user.id)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Avoid calling a shadowed "Number" identifier — use parseInt / unary plus instead
        const tenantHeader = (_f = (_c = (_b = req.headers['x-tenant-id']) !== null && _b !== void 0 ? _b : req.headers['x-tenant']) !== null && _c !== void 0 ? _c : (_d = req.query) === null || _d === void 0 ? void 0 : _d.tenant_id) !== null && _f !== void 0 ? _f : (_g = req.body) === null || _g === void 0 ? void 0 : _g.tenant_id;
        const companyHeader = (_k = (_h = req.headers['x-company-id']) !== null && _h !== void 0 ? _h : (_j = req.query) === null || _j === void 0 ? void 0 : _j.company_id) !== null && _k !== void 0 ? _k : (_l = req.body) === null || _l === void 0 ? void 0 : _l.company_id;
        const tenant_id = tenantHeader ? String(tenantHeader) : null;
        const company_id = companyHeader != null && companyHeader !== '' ? parseInt(String(companyHeader), 10) : null;
        req.tenant_id = tenant_id;
        req.company_id = company_id;
        return next();
    }
    catch (_e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
