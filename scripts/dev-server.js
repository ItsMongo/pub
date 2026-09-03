#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/dev-server.js — LOCAL DEVELOPMENT ONLY
//
// Serves the static files in this folder AND mimics the subset of the SHTTPS+
// Database REST API that the app uses, so you can build and test on this laptop
// without touching the Shield. Production is still SHTTPS+ itself.
//
//   node scripts/dev-server.js                       # http://localhost:8080
//   PORT=9000 DB=data/firearms.db node scripts/dev-server.js
//
// Zero dependencies — Node 24's built-in node:sqlite + node:http.
//
// Implemented endpoints (see https://shttps.phlox.dev/api-browser/):
//   GET    /api/db/schema
//   GET    /api/db/table      ?table= &columns= &limit= &offset= &sort= &sort-order= &filters= &rowsAsObjects=
//   POST   /api/db/query      body = SQL (text/plain)
//   POST   /api/db/insert     form: table, values (JSON obj or array)
//   PUT    /api/db/update     form: table, values (JSON obj), filters (JSON)
//   DELETE /api/db/delete     form: table, filters (JSON)
// ─────────────────────────────────────────────────────────────────────────────

const http = require("node:http");
const fs   = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT    = path.resolve(__dirname, "..");
const PORT    = Number(process.env.PORT || 8080);
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");

const db = new DatabaseSync(DB_PATH);

// Real table names, looked up live so a schema change (e.g. push-to-shttps.js
// recreating tables) is picked up without restarting the server.
const listTables = () => new Set(
    db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(r => r.name)
);
const TABLES = { has: (name) => listTables().has(name) };

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".ico": "image/x-icon", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
};

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...CORS, ...headers });
    res.end(body);
};
const sendJson = (res, status, obj) =>
    send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });

const readBody = (req) => new Promise((resolve, reject) => {
    let b = "";
    req.on("data", c => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", reject);
});

// filters JSON: { "clauses": ["col=", "col?"], "args": [1, "%x%"] }
// operator is the trailing char of each clause string.
const OPS = { "=": "=", ">": ">", "<": "<", "]": ">=", "[": "<=", "!": "!=", "?": "LIKE" };
function whereFromFilters(filtersJson) {
    if (!filtersJson) return { sql: "", args: [] };
    const { clauses = [], args = [] } = JSON.parse(filtersJson);
    const parts = clauses.map((clause) => {
        const col = clause.slice(0, -1);
        const op  = OPS[clause.slice(-1)] || "=";
        return `"${col}" ${op} ?`;
    });
    return { sql: parts.length ? " WHERE " + parts.join(" AND ") : "", args };
}

const isRead = (sql) => /^\s*(select|with|pragma|explain)\b/i.test(sql);

async function handleApi(req, res, url) {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const p = url.pathname;
    const q = url.searchParams;

    if (p === "/api/db/schema" && req.method === "GET") {
        const only = q.get("table");
        const names = (only ? [only] : [...listTables()]).filter(n => TABLES.has(n));
        const out = names.map(n => ({
            name: n,
            rowCount: db.prepare(`SELECT COUNT(*) c FROM "${n}"`).get().c,
            columns: db.prepare(`PRAGMA table_info("${n}")`).all().map(c => ({
                name: c.name, type: c.type,
                primaryKey: !!c.pk, notNull: !!c.notnull,
            })),
        }));
        return sendJson(res, 200, only ? (out[0] || null) : out);
    }

    if (p === "/api/db/table" && req.method === "GET") {
        const table = q.get("table");
        if (!TABLES.has(table)) return sendJson(res, 404, { error: "no such table" });

        const cols = q.get("columns")
            ? q.get("columns").split(",").map(c => `"${c.trim()}"`).join(", ")
            : "*";
        const { sql: whereSql, args } = whereFromFilters(q.get("filters"));

        let sql = `SELECT ${cols} FROM "${table}"${whereSql}`;
        if (q.get("sort")) {
            const dir = q.get("sort-order") === "desc" ? "DESC" : "ASC";
            sql += ` ORDER BY "${q.get("sort")}" ${dir}`;
        }
        const limit  = Math.max(0, Number(q.get("limit")  || 1000));
        const offset = Math.max(0, Number(q.get("offset") || 0));
        sql += ` LIMIT ${limit} OFFSET ${offset}`;

        const stmt = db.prepare(sql);
        const objs = stmt.all(...args);
        const data = q.get("rowsAsObjects") === "true"
            ? objs
            : objs.map(r => Object.values(r));
        const total = db.prepare(
            `SELECT COUNT(*) c FROM "${table}"${whereSql}`
        ).get(...args).c;
        return sendJson(res, 200, { total, data });
    }

    if (p === "/api/db/query" && req.method === "POST") {
        const sql = await readBody(req);
        const limit  = Number(q.get("limit")  || 100);
        const offset = Number(q.get("offset") || 0);
        try {
            if (isRead(sql)) {
                const all  = db.prepare(sql).all();
                const page = all.slice(offset, offset + limit);
                const columns = page[0] ? Object.keys(page[0]) : [];
                return sendJson(res, 200, {
                    offset, limit, columns,
                    data: page.map(r => columns.map(c => r[c])),
                });
            }
            // Non-SELECT: exec() runs several ';'-separated statements in one go,
            // matching SHTTPS+ ("all run in one transaction, only the last returns rows").
            db.exec(sql);
            return sendJson(res, 200, { ok: true });
        } catch (e) {
            return send(res, 420, String(e.message), { "Content-Type": "text/plain" });
        }
    }

    if (p === "/api/db/insert" && req.method === "POST") {
        const body   = new URLSearchParams(await readBody(req));
        const table  = body.get("table");
        if (!TABLES.has(table)) return sendJson(res, 404, { error: "no such table" });
        const parsed = JSON.parse(body.get("values"));
        const rows   = Array.isArray(parsed) ? parsed : [parsed];
        const ids    = [];
        for (const row of rows) {
            const keys = Object.keys(row);
            const sql  = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) `
                       + `VALUES (${keys.map(() => "?").join(",")})`;
            const info = db.prepare(sql).run(...keys.map(k => row[k]));
            ids.push(Number(info.lastInsertRowid));
        }
        return sendJson(res, 200,
            Array.isArray(parsed) ? { generated_ids: ids } : { generated_id: ids[0] });
    }

    if (p === "/api/db/update" && req.method === "PUT") {
        const body  = new URLSearchParams(await readBody(req));
        const table = body.get("table");
        if (!TABLES.has(table)) return sendJson(res, 404, { error: "no such table" });
        const values = JSON.parse(body.get("values"));
        const keys   = Object.keys(values);
        const { sql: whereSql, args } = whereFromFilters(body.get("filters"));
        const sql = `UPDATE "${table}" SET ${keys.map(k => `"${k}"=?`).join(",")}${whereSql}`;
        const info = db.prepare(sql).run(...keys.map(k => values[k]), ...args);
        return sendJson(res, 200, { updated_rows: info.changes });
    }

    if (p === "/api/db/delete" && req.method === "DELETE") {
        const body  = new URLSearchParams(await readBody(req));
        const table = body.get("table");
        if (!TABLES.has(table)) return sendJson(res, 404, { error: "no such table" });
        const { sql: whereSql, args } = whereFromFilters(body.get("filters"));
        const info = db.prepare(`DELETE FROM "${table}"${whereSql}`).run(...args);
        return sendJson(res, 200, { deleted_rows: info.changes });
    }

    return sendJson(res, 404, { error: `unknown endpoint ${req.method} ${p}` });
}

function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "mycollection.html";
    const filePath = path.join(ROOT, path.normalize(rel));
    if (!filePath.startsWith(ROOT)) return send(res, 403, "forbidden");
    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) return send(res, 404, `not found: ${rel}`);
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(filePath).toLowerCase()]
                          || "application/octet-stream",
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
        handleApi(req, res, url).catch(e => {
            console.error(e);
            sendJson(res, 500, { error: String(e.message) });
        });
    } else {
        serveStatic(req, res, url);
    }
}).listen(PORT, () => {
    console.log(`dev server   http://localhost:${PORT}/mycollection.html`);
    console.log(`database     ${DB_PATH}`);
    console.log(`tables       ${[...listTables()].join(", ") || "(none yet)"}`);
});
