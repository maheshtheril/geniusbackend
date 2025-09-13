"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTenant = setTenant;
// @ts-nocheck
function setTenant(req, _res, next) {
    var _a, _b, _c, _d, _e;
    const tenantHeader = (_d = (_b = (_a = req.headers['x-tenant-id']) !== null && _a !== void 0 ? _a : req.headers['x-tenant']) !== null && _b !== void 0 ? _b : (_c = req.query) === null || _c === void 0 ? void 0 : _c.tenant_id) !== null && _d !== void 0 ? _d : (_e = req.body) === null || _e === void 0 ? void 0 : _e.tenant_id;
    req.tenant_id = tenantHeader ? String(tenantHeader) : null;
    next();
}
