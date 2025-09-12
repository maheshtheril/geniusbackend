"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePermission = requirePermission;
function requirePermission(...need) {
    return (req, res, next) => {
        var _a;
        const perms = ((_a = req.auth) === null || _a === void 0 ? void 0 : _a.permissions) || [];
        if (perms.includes('*'))
            return next();
        const ok = need.every(n => perms.includes(n) || perms.includes(n.split(':')[0] + ':*'));
        if (!ok)
            return res.status(403).json({ error: 'Forbidden' });
        next();
    };
}
