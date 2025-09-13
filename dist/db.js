"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
// src/db.ts
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("[DB] Missing DATABASE_URL");
}
const useSSL = ((_a = process.env.PGSSL) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === "true" ||
    // Render-managed Postgres usually needs SSL in prod
    process.env.NODE_ENV === "production";
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    // optional timeouts to avoid hanging -> 502s
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    max: Number(process.env.PGPOOL_MAX || 10),
});
exports.pool.on("error", (err) => {
    console.error("[DB] Pool error:", err);
});
