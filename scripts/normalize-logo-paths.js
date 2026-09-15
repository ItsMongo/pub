#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/normalize-logo-paths.js — one-time items.maker_logo rewrite for the
// files scripts/normalize-logos.js converted to PNG (from jpg/webp, needed for
// transparent padding). Reads the rename map that script wrote.
//
//   node scripts/normalize-logo-paths.js                                   # preview, local db
//   node scripts/normalize-logo-paths.js --apply                           # write, local db
//   node scripts/normalize-logo-paths.js http://<host>:8080 --user=NAME --pass=SECRET
//   node scripts/normalize-logo-paths.js http://<host>:8080 --user=NAME --pass=SECRET --apply
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, filters, argsFromProcess } = require("./lib/shttps-client");

const a       = argsFromProcess();
const APPLY   = a.flags.has("--apply");
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");
const SQL     = "SELECT item_id, maker_logo FROM items WHERE maker_logo IS NOT NULL AND maker_logo != ''";

const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, "logo-renames.json"), "utf8"));

function planFrom(rows) {
    const changes = [];
    for (const r of rows) {
        const to = MAP[r.maker_logo];
        if (to && to !== r.maker_logo) changes.push({ id: r.item_id, from: r.maker_logo, to });
    }
    return changes;
}

function report(changes) {
    if (!changes.length) { console.log("Nothing to change — no maker_logo matches the renamed set."); return false; }
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
    const upd = db.prepare("UPDATE items SET maker_logo = ? WHERE item_id = ?");
    for (const c of changes) upd.run(c.to, c.id);
    console.log(`Applied ${changes.length} update(s).`);
}

async function runRemote() {
    console.log(`Target   ${a.base}\n`);
    const client = create(a);
    const res  = await client.runSql(SQL);
    const cols = res.columns || [];
    const iId = cols.indexOf("item_id"), iM = cols.indexOf("maker_logo");
    const rows = (res.data || []).map(row => ({ item_id: row[iId], maker_logo: row[iM] }));
    const changes = planFrom(rows);
    if (!report(changes)) return;
    if (!APPLY) { console.log("(preview only — pass --apply to write)"); return; }
    for (const c of changes) await client.update("items", { maker_logo: c.to }, filters({ item_id: c.id }));
    console.log(`Applied ${changes.length} update(s).`);
}

(a.urlArg ? runRemote() : runLocal())
    .catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
