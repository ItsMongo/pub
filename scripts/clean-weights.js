#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/clean-weights.js — one-time cleanup of the items.weight strings.
//
// Strips "unloaded" / "approximate" and the punctuation they leave behind —
// the same transform js/app.js does at display time (cleanWeight). Shows a
// before/after preview by default; pass --apply to write the changes.
//
//   node scripts/clean-weights.js                                   # preview, local db
//   node scripts/clean-weights.js --apply                           # write, local db
//   node scripts/clean-weights.js http://192.168.4.167:8080 --user=NAME --pass=SECRET
//   node scripts/clean-weights.js http://192.168.4.167:8080 --user=NAME --pass=SECRET --apply
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, filters, argsFromProcess } = require("./lib/shttps-client");

// Keep in sync with cleanWeight() in js/app.js.
function cleanWeight(w) {
    if (w == null) return "";
    return String(w)
        .replace(/\b(un-?loaded|approx(?:imate|\.)?)\b/gi, "")
        .replace(/[,;]\s*(?=[,;)\s]|$)/g, "")
        .replace(/\s+([)\].,;])/g, "$1")
        .replace(/\(\s*\)/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

const a       = argsFromProcess();
const APPLY   = a.flags.has("--apply");
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");
const SQL     = "SELECT item_id, weight FROM items WHERE weight IS NOT NULL AND weight != ''";

function planFrom(rows) {
    const changes = [];
    for (const r of rows) {
        const to = cleanWeight(r.weight);
        if (to !== (r.weight ?? "")) changes.push({ id: r.item_id, from: r.weight, to });
    }
    return changes;
}

function report(changes) {
    if (!changes.length) { console.log("Nothing to clean — every weight is already tidy."); return false; }
    console.log(`${changes.length} row(s) would change:\n`);
    for (const c of changes) {
        console.log(`  ${String(c.id).padEnd(7)} ${JSON.stringify(c.from)}`);
        console.log(`  ${"".padEnd(7)}   -> ${JSON.stringify(c.to)}\n`);
    }
    return true;
}

async function runLocal() {
    console.log(`Target   ${DB_PATH}\n`);
    const db = new DatabaseSync(DB_PATH);
    const changes = planFrom(db.prepare(SQL).all());
    if (!report(changes)) return;
    if (!APPLY) { console.log("(preview only — pass --apply to write)"); return; }
    const upd = db.prepare("UPDATE items SET weight = ? WHERE item_id = ?");
    for (const c of changes) upd.run(c.to, c.id);
    console.log(`Applied ${changes.length} update(s).`);
}

async function runRemote() {
    console.log(`Target   ${a.base}\n`);
    const client = create(a);
    const res  = await client.runSql(SQL);
    const cols = res.columns || [];
    const iId = cols.indexOf("item_id"), iW = cols.indexOf("weight");
    const rows = (res.data || []).map(row => ({ item_id: row[iId], weight: row[iW] }));
    const changes = planFrom(rows);
    if (!report(changes)) return;
    if (!APPLY) { console.log("(preview only — pass --apply to write)"); return; }
    for (const c of changes) await client.update("items", { weight: c.to }, filters({ item_id: c.id }));
    console.log(`Applied ${changes.length} update(s).`);
}

(a.urlArg ? runRemote() : runLocal())
    .catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
