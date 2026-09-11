#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/fix-flag-paths.js — one-time fix for items.flag_image after the
// ./flags/ folder moved to ./images/flags/.
//
// Rewrites any "flags/<file>" value to "images/flags/<file>". Preview by
// default, --apply writes. Local db by default, or a device URL + creds:
//
//   node scripts/fix-flag-paths.js                                   # preview, local db
//   node scripts/fix-flag-paths.js --apply                           # write, local db
//   node scripts/fix-flag-paths.js http://192.168.4.167:8080 --user=NAME --pass=SECRET
//   node scripts/fix-flag-paths.js http://192.168.4.167:8080 --user=NAME --pass=SECRET --apply
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, filters, argsFromProcess } = require("./lib/shttps-client");

const a       = argsFromProcess();
const APPLY   = a.flags.has("--apply");
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");
const SQL     = "SELECT item_id, flag_image FROM items WHERE flag_image LIKE 'flags/%'";

function planFrom(rows) {
    return rows.map(r => ({ id: r.item_id, from: r.flag_image, to: "images/" + r.flag_image }));
}

function report(changes) {
    if (!changes.length) { console.log("Nothing to fix — no flag_image still points at flags/."); return false; }
    console.log(`${changes.length} row(s) would change:\n`);
    for (const c of changes) console.log(`  ${String(c.id).padEnd(7)} ${c.from}  ->  ${c.to}`);
    console.log();
    return true;
}

async function runLocal() {
    console.log(`Target   ${DB_PATH}\n`);
    const db = new DatabaseSync(DB_PATH);
    const changes = planFrom(db.prepare(SQL).all());
    if (!report(changes)) return;
    if (!APPLY) { console.log("(preview only — pass --apply to write)"); return; }
    const upd = db.prepare("UPDATE items SET flag_image = ? WHERE item_id = ?");
    for (const c of changes) upd.run(c.to, c.id);
    console.log(`Applied ${changes.length} update(s).`);
}

async function runRemote() {
    console.log(`Target   ${a.base}\n`);
    const client = create(a);
    const res  = await client.runSql(SQL);
    const cols = res.columns || [];
    const iId = cols.indexOf("item_id"), iF = cols.indexOf("flag_image");
    const rows = (res.data || []).map(row => ({ item_id: row[iId], flag_image: row[iF] }));
    const changes = planFrom(rows);
    if (!report(changes)) return;
    if (!APPLY) { console.log("(preview only — pass --apply to write)"); return; }
    for (const c of changes) await client.update("items", { flag_image: c.to }, filters({ item_id: c.id }));
    console.log(`Applied ${changes.length} update(s).`);
}

(a.urlArg ? runRemote() : runLocal())
    .catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
