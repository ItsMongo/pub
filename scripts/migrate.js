#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/migrate.js — bring a firearms database's schema up to date.
//
//   node scripts/migrate.js                                   # local data/firearms.db
//   node scripts/migrate.js http://192.168.4.167:8080 --user=NAME --pass=SECRET   # the Shield
//   node scripts/migrate.js [target] --dry-run                # show what would run
//
// Only additive, idempotent changes: it reads the current columns and ADDs any
// that are missing (all as nullable TEXT). Safe to run repeatedly.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, argsFromProcess } = require("./lib/shttps-client");

// Columns each table is expected to have. Anything missing is added as TEXT.
const WANT = {
    load_data: [
        "load_date", "brass", "primer", "powder", "charge_grains",
        "bullet_caliber", "bullet_type", "bullet_grains",
        "ballistic_coefficient", "sectional_density", "velocity_fps",
        "sync_uid",   // stable id for cross-device sync (js/sync.js)
    ],
    range_notes: [
        "batch_num", "zero_yards", "sight_type", "shooting_pos", "accuracy_moa",
        "targets",   // JSON array of target-image filenames (upload feature)
        "sync_uid",
    ],
    service_history: [
        "svc_type", "maint_cost",
        "sync_uid",
    ],
    transactions: [
        "docs",   // JSON [{filename,title,type}] — purchase documents/receipts
    ],
    items: [
        "disposed",       // "1" when sold / disposed of
        "disposed_date",  // when (ISO date)
    ],
};

// Tables that must exist (created if missing). Sync bookkeeping — see js/db.js
// (SYNC_DDL) and js/sync.js.
const WANT_TABLES = [
    `CREATE TABLE IF NOT EXISTS sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT,`
    + ` ts TEXT NOT NULL, kind TEXT NOT NULL, tbl TEXT, payload TEXT NOT NULL,`
    + ` synced INTEGER NOT NULL DEFAULT 0, synced_ts TEXT)`,
    `CREATE TABLE IF NOT EXISTS sync_state (source_host TEXT PRIMARY KEY,`
    + ` last_seq INTEGER NOT NULL DEFAULT 0, updated_ts TEXT)`,
    `CREATE TABLE IF NOT EXISTS sync_snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT,`
    + ` ts TEXT NOT NULL, label TEXT, source_host TEXT, enc TEXT, payload TEXT NOT NULL)`,
];

const a       = argsFromProcess();
const DRY_RUN = a.flags.has("--dry-run");
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");

function planFor(existingByTable, haveTables) {
    const stmts = [];
    for (const ddl of WANT_TABLES) {
        const name = (ddl.match(/EXISTS (\w+)/) || [])[1];
        if (name && haveTables && !haveTables.has(name)) stmts.push(ddl);
    }
    for (const [table, cols] of Object.entries(WANT)) {
        const have = existingByTable[table];
        if (!have) { console.warn(`(table "${table}" not found — skipping)`); continue; }
        for (const col of cols) {
            if (!have.has(col)) stmts.push(`ALTER TABLE "${table}" ADD COLUMN "${col}" TEXT`);
        }
    }
    return stmts;
}

async function migrateLocal() {
    console.log(`Target   ${DB_PATH}`);
    const db = new DatabaseSync(DB_PATH);
    const existing = {};
    for (const table of Object.keys(WANT)) {
        try {
            existing[table] = new Set(
                db.prepare(`PRAGMA table_info("${table}")`).all().map(r => r.name));
        } catch { /* table missing */ }
    }
    const haveTables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    const stmts = planFor(existing, haveTables);
    finish(stmts, (sql) => { db.exec(sql); });
}

async function migrateRemote() {
    console.log(`Target   ${a.base}`);
    const client = create(a);
    const existing = {};
    for (const table of Object.keys(WANT)) {
        const r = await client.runSql(`PRAGMA table_info("${table}")`);
        const nameIdx = (r.columns || []).indexOf("name");
        if (nameIdx === -1) continue;
        existing[table] = new Set((r.data || []).map(row => row[nameIdx]));
    }
    const tbl = await client.runSql("SELECT name FROM sqlite_master WHERE type='table'");
    const tIdx = (tbl.columns || []).indexOf("name");
    const haveTables = new Set(tIdx === -1 ? [] : (tbl.data || []).map(row => row[tIdx]));
    await finishAsync(planFor(existing, haveTables), (sql) => client.runSql(sql));
}

function finish(stmts, run) {
    if (!stmts.length) { console.log("Schema already up to date."); return; }
    console.log(`${stmts.length} change(s):`);
    for (const sql of stmts) {
        console.log("  " + sql);
        if (!DRY_RUN) run(sql);
    }
    console.log(DRY_RUN ? "\n(dry run — nothing applied)" : "\nDone.");
}
async function finishAsync(stmts, run) {
    if (!stmts.length) { console.log("Schema already up to date."); return; }
    console.log(`${stmts.length} change(s):`);
    for (const sql of stmts) {
        console.log("  " + sql);
        if (!DRY_RUN) await run(sql);
    }
    console.log(DRY_RUN ? "\n(dry run — nothing applied)" : "\nDone.");
}

// Go remote only when a URL is passed explicitly; otherwise migrate the local file.
(a.urlArg ? migrateRemote() : migrateLocal())
    .catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
