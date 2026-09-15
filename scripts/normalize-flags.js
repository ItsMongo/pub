#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/normalize-flags.js — one-time swap of items.flag_image from the old
// mixed-size raster flags to a consistent SVG set (flag-icons, 4x3 / 640x480,
// MIT licensed — https://github.com/lipis/flag-icons), plus two historical
// flags (Nazi Germany, Soviet Union) that flag-icons doesn't carry, sourced as
// SVGs from Wikimedia Commons so they're vector too, not upscaled raster.
//
//   node scripts/normalize-flags.js                                   # preview, local db
//   node scripts/normalize-flags.js --apply                           # write, local db
//   node scripts/normalize-flags.js http://<host>:8080 --user=NAME --pass=SECRET
//   node scripts/normalize-flags.js http://<host>:8080 --user=NAME --pass=SECRET --apply
//
// Run scripts/push-flags.js afterward to get images/flags/*.svg onto that
// device, then delete the old *.png flag files it lists as orphaned.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, filters, argsFromProcess } = require("./lib/shttps-client");

const a       = argsFromProcess();
const APPLY   = a.flags.has("--apply");
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");
const SQL     = "SELECT item_id, flag_image FROM items WHERE flag_image IS NOT NULL AND flag_image != ''";

// old images/flags/<name> -> new images/flags/<name>
const MAP = {
    "images/flags/Austria.png":        "images/flags/at.svg",
    "images/flags/Belgium.png":        "images/flags/be.svg",
    "images/flags/China.png":          "images/flags/cn.svg",
    "images/flags/CzechRepublic.png":  "images/flags/cz.svg",
    "images/flags/Egypt.png":          "images/flags/eg.svg",
    "images/flags/France.png":         "images/flags/fr.svg",
    "images/flags/Germany.png":        "images/flags/de.svg",
    "images/flags/Italy.png":          "images/flags/it.svg",
    "images/flags/Japan.png":          "images/flags/jp.svg",
    "images/flags/Netherlands.png":    "images/flags/nl.svg",
    "images/flags/Poland.png":         "images/flags/pl.svg",
    "images/flags/Spain.png":          "images/flags/es.svg",
    "images/flags/USA.png":            "images/flags/us.svg",
    "images/flags/United Kingdom.png": "images/flags/gb.svg",
    "images/flags/Nazi.png":           "images/flags/nazi-germany.svg",
    "images/flags/cccp.png":           "images/flags/soviet-union.svg",
};

function planFrom(rows) {
    const changes = [];
    for (const r of rows) {
        const to = MAP[r.flag_image];
        if (to && to !== r.flag_image) changes.push({ id: r.item_id, from: r.flag_image, to });
    }
    return changes;
}

function report(changes) {
    if (!changes.length) { console.log("Nothing to change — no flag_image matches the old raster set."); return false; }
    console.log(`${changes.length} row(s) would change:\n`);
    const byPair = new Map();
    for (const c of changes) {
        const k = `${c.from} -> ${c.to}`;
        byPair.set(k, (byPair.get(k) || 0) + 1);
    }
    for (const [k, n] of byPair) console.log(`  ${k}  (x${n})`);
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
