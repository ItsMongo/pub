#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/push-to-shttps.js — load data/firearms.db into a running SHTTPS+ server
//
// The Android build of SHTTPS+ has no "attach existing database" button: enabling
// the SQLite feature just creates its own empty database.db. This script copies
// your local schema + data into that database over the REST API, using the custom
// SQL endpoint (Settings → "Enable API to call custom SQL" must be on).
//
//   node scripts/push-to-shttps.js http://192.168.4.167:8080
//   node scripts/push-to-shttps.js http://192.168.4.167:8080 --dry-run
//
// (Or set the SHTTPS_URL env var instead of passing the URL as an argument.
//  PowerShell:  $env:SHTTPS_URL = "http://192.168.4.167:8080"; node scripts/push-to-shttps.js)
//
// It DROPs and recreates the five collection tables (items, transactions,
// load_data, range_notes, service_history) each run, so it is safe to re-run.
// It never touches SHTTPS's own shttps_* / user tables.
//
// Schema goes through /api/db/query one statement at a time; row data goes
// through /api/db/insert as JSON (Settings needs BOTH "Enable API to call
// custom SQL" and "Enable API to modify tables data" on).
//
// Auth: pass your SHTTPS+ login. Works with either Basic auth or session/web
// auth mode (the script logs in and carries the cookie automatically):
//   node scripts/push-to-shttps.js http://192.168.4.167:8080 --user=NAME --pass=SECRET
// To keep the password out of shell history, set $env:SHTTPS_PASS instead.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT     = path.resolve(__dirname, "..");
const DB_PATH  = path.resolve(ROOT, process.env.DB || "data/firearms.db");
const DRY_RUN  = process.argv.includes("--dry-run");
const BATCH_BYTES = 48 * 1024; // keep each POST body well under any server limit

// URL from the first non-flag argument, else the SHTTPS_URL env var.
const urlArg = process.argv.slice(2).find(a => !a.startsWith("--"));
const BASE   = (urlArg || process.env.SHTTPS_URL || "").replace(/\/$/, "");

// Basic-auth credentials: --user=NAME --pass=SECRET  (or SHTTPS_USER / SHTTPS_PASS)
const argVal = (name) => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
};
const USER = argVal("user") || process.env.SHTTPS_USER;
const PASS = argVal("pass") || process.env.SHTTPS_PASS || "";

if (!BASE && !DRY_RUN) {
    console.error("Usage:  node scripts/push-to-shttps.js http://<shield-ip>:8080  [--dry-run]");
    process.exit(1);
}

// Parent before children — matters if the server runs PRAGMA foreign_keys=ON.
const TABLE_ORDER = ["items", "transactions", "load_data", "range_notes", "service_history"];

const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Strip SQL comments and collapse whitespace so each DDL statement is a single
// clean line — SHTTPS+ mishandles inline "--" comments in multi-line statements.
function cleanDdl(sql) {
    return sql
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildPlan() {
    const present = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    );
    const tables = TABLE_ORDER.filter(t => present.has(t));
    if (!tables.length) throw new Error(`No expected tables found in ${DB_PATH}`);

    const ddl = [];
    for (const t of [...tables].reverse()) ddl.push(`DROP TABLE IF EXISTS "${t}"`);
    for (const t of tables) {
        const { sql } = db.prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
        ).get(t);
        ddl.push(cleanDdl(sql));
        for (const idx of db.prepare(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL"
        ).all(t)) {
            ddl.push(cleanDdl(idx.sql));
        }
    }

    const rowsByTable = {};
    let rowCount = 0;
    for (const t of tables) {
        rowsByTable[t] = db.prepare(`SELECT * FROM "${t}"`).all();
        rowCount += rowsByTable[t].length;
    }

    return { tables, ddl, rowsByTable, rowCount };
}

// Split an array of rows into chunks whose JSON stays under maxBytes.
function chunkRows(rows, maxBytes) {
    const chunks = [];
    let cur = [];
    let size = 2;
    for (const row of rows) {
        const len = JSON.stringify(row).length + 1;
        if (cur.length && size + len > maxBytes) { chunks.push(cur); cur = []; size = 2; }
        cur.push(row);
        size += len;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
}

// SHTTPS+'s login form hashes the password with this exact function (FNV-1a,
// 32-bit) before POSTing it — see shttps-static-public/auth/login.js.
function fnv1aHex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
}

let sessionCookie = null; // set if the server turns out to use session/web auth

// Log in against session/web auth mode and remember the SESSION_ID cookie.
async function sessionLogin() {
    const body = new URLSearchParams({ username: USER, password: fnv1aHex(PASS) }).toString();
    const res = await fetch(`${BASE}/api/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (res.status === 404) return false;               // route absent -> not session mode
    if (!res.ok) throw new Error(`Session login failed (HTTP ${res.status}) — check --user / --pass.`);
    const raw = (res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""]).join("; ");
    const m = raw.match(/SESSION_ID=([^;]+)/);
    if (!m) throw new Error("Login succeeded but no SESSION_ID cookie came back.");
    sessionCookie = `SESSION_ID=${m[1]}`;
    return true;
}

// One authenticated request, with a one-time session-login retry if the server
// turns out to be in session/web auth mode rather than Basic.
async function apiFetch(pathAndQuery, { method, contentType, body }) {
    const build = () => {
        const headers = { "Content-Type": contentType };
        if (sessionCookie) headers.Cookie = sessionCookie;
        else if (USER) headers.Authorization =
            "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
        return fetch(`${BASE}${pathAndQuery}`, { method, headers, body });
    };

    let res = await build();
    if (res.status === 401 && !sessionCookie && USER &&
        !(res.headers.get("www-authenticate") || "").toLowerCase().includes("basic")) {
        if (await sessionLogin()) res = await build();
    }

    const text = await res.text();
    if (!res.ok) {
        if (res.status === 401) throw new Error(
            USER ? `HTTP 401 — credentials rejected. Check --user / --pass.`
                 : `HTTP 401 — server needs auth. Re-run with  --user=NAME --pass=SECRET`);
        if (res.status === 403) throw new Error(
            `HTTP 403 — authenticated but not allowed. In SHTTPS+ turn on "Enable API to call ` +
            `custom SQL" and "Enable API to modify tables data", and give this user the rights.`);
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    return text;
}

const runSql = (sql) =>
    apiFetch(`/api/db/query?includeNames=true&limit=1000`, { method: "POST", contentType: "text/plain", body: sql });

const insertRows = (table, rows) =>
    apiFetch(`/api/db/insert`, {
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: new URLSearchParams({ table, values: JSON.stringify(rows) }).toString(),
    });

async function verify(tables) {
    const sql = tables.map(t => `SELECT '${t}' AS t, COUNT(*) AS n FROM "${t}"`).join(" UNION ALL ");
    try {
        const json = JSON.parse(await runSql(sql));
        console.log("\nRow counts on the server:");
        for (const row of json.data || []) console.log(`  ${String(row[0]).padEnd(18)} ${row[1]}`);
    } catch (e) {
        console.log("\n(could not read back row counts:", e.message + ")");
    }
}

(async () => {
    const { tables, ddl, rowsByTable, rowCount } = buildPlan();
    console.log(`Source   ${DB_PATH}`);
    console.log(`Tables   ${tables.join(", ")}`);
    console.log(`Rows     ${rowCount}`);
    console.log(`Target   ${DRY_RUN ? "(dry run — nothing sent)" : BASE}`);

    if (DRY_RUN) {
        console.log(`\nWould run ${ddl.length} DDL statements, then insert:`);
        for (const t of tables) console.log(`  ${t.padEnd(18)} ${rowsByTable[t].length} rows`);
        console.log("\n--- DDL ---\n" + ddl.join("\n"));
        return;
    }

    for (const stmt of ddl) {
        await runSql(stmt);
        console.log(`ddl  ${stmt.slice(0, 70)}${stmt.length > 70 ? "…" : ""}`);
    }

    for (const t of tables) {
        const chunks = chunkRows(rowsByTable[t], BATCH_BYTES);
        let done = 0;
        for (const chunk of chunks) {
            await insertRows(t, chunk);
            done += chunk.length;
            console.log(`ins  ${t.padEnd(18)} ${done}/${rowsByTable[t].length}`);
        }
    }

    await verify(tables);
    console.log("\nDone.");
})().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
