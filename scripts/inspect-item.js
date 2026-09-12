#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/inspect-item.js — read-only look at one firearm's DB row + child rows
// + whether the files they reference (gallery, target photos, purchase docs)
// actually exist on that device. Useful for "did the file really sync, or was
// it never there on the source either" questions.
//
//   node scripts/inspect-item.js ZZZZ                                    # local db
//   node scripts/inspect-item.js ZZZZ http://192.168.4.167:8080 --user=NAME --pass=SECRET
//
// Prints, doesn't change anything.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { create, argsFromProcess } = require("./lib/shttps-client");

const itemId = process.argv[2];
if (!itemId) {
    console.error("Usage:  node scripts/inspect-item.js <item_id> [url] [--user=NAME --pass=SECRET]");
    process.exit(1);
}

// argsFromProcess() reads the first non-flag arg as the URL; itemId is argv[2],
// so re-parse starting from argv[3] for the remote case.
const a = argsFromProcess(["node", "inspect-item.js", ...process.argv.slice(3)]);
const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, process.env.DB || "data/firearms.db");

function safeJsonArray(raw) {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function checkFile(url, authHeader, relPath) {
    try {
        const res = await fetch(`${url}/api/file/download?path=${encodeURIComponent(relPath)}`,
            { headers: authHeader });
        return res.ok ? `OK (${res.headers.get("content-length") || "?"} bytes)` : `MISSING (${res.status})`;
    } catch (e) {
        return `UNREACHABLE (${e.message})`;
    }
}

async function main() {
    let item, loadData, rangeNotes, serviceHistory, transactions, fileBase, authHeader;

    if (a.urlArg) {
        console.log(`Target   ${a.base}\n`);
        const client = create(a);
        const q = (sql) => client.runSql(sql).then(r => {
            const cols = r.columns || [];
            return (r.data || []).map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
        });
        [item] = await q(`SELECT * FROM items WHERE item_id = '${itemId}'`);
        loadData       = await q(`SELECT * FROM load_data WHERE item_id = '${itemId}'`);
        rangeNotes     = await q(`SELECT * FROM range_notes WHERE item_id = '${itemId}'`);
        serviceHistory = await q(`SELECT * FROM service_history WHERE item_id = '${itemId}'`);
        transactions   = await q(`SELECT * FROM transactions WHERE item_id = '${itemId}'`);
        fileBase = a.base.replace(/\/$/, "");
        authHeader = a.user ? { Authorization: "Basic " + Buffer.from(`${a.user}:${a.pass || ""}`).toString("base64") } : {};
    } else {
        console.log(`Target   ${DB_PATH}\n`);
        const db = new DatabaseSync(DB_PATH);
        const one = (sql) => db.prepare(sql).all();
        [item] = one(`SELECT * FROM items WHERE item_id = '${itemId}'`);
        loadData       = one(`SELECT * FROM load_data WHERE item_id = '${itemId}'`);
        rangeNotes     = one(`SELECT * FROM range_notes WHERE item_id = '${itemId}'`);
        serviceHistory = one(`SELECT * FROM service_history WHERE item_id = '${itemId}'`);
        transactions   = one(`SELECT * FROM transactions WHERE item_id = '${itemId}'`);
        fileBase = null; // local file existence checked on disk instead, below
    }

    if (!item) { console.log(`No "items" row for "${itemId}" on this device.`); return; }
    console.log(`items: ${item.make} ${item.model}  (disposed=${item.disposed || "no"})`);
    console.log(`  flag_image: ${item.flag_image || "(none)"}`);
    console.log(`  maker_logo: ${item.maker_logo || "(none)"}`);
    console.log(`\ntransactions (${transactions.length}):`);
    for (const t of transactions) {
        const docs = safeJsonArray(t.docs);
        console.log(`  [${t.transaction_type}${t.source ? "/" + t.source : ""}] docs column: ${t.docs || "(none)"}`);
        for (const d of docs) console.log(`    -> images/${itemId}/docs/${d.filename}`);
    }
    console.log(`\nrange_notes (${rangeNotes.length}):`);
    for (const r of rangeNotes) {
        const targets = safeJsonArray(r.targets);
        console.log(`  [${r.date || r.range_id}] targets column: ${r.targets || "(none)"}`);
        for (const f of targets) console.log(`    -> images/${itemId}/targets/${f}`);
    }
    console.log(`\nload_data: ${loadData.length} row(s), service_history: ${serviceHistory.length} row(s)`);

    if (!fileBase) {
        console.log(`\n(local db — checking file existence needs a URL: re-run with the device's address)`);
        return;
    }

    console.log(`\nFile check on ${fileBase}:`);
    console.log(`  images.json: ${await checkFile(fileBase, authHeader, `images/${itemId}/images.json`)}`);
    for (const t of transactions) {
        for (const d of safeJsonArray(t.docs)) {
            console.log(`  docs/${d.filename}: ${await checkFile(fileBase, authHeader, `images/${itemId}/docs/${d.filename}`)}`);
        }
    }
    for (const r of rangeNotes) {
        for (const f of safeJsonArray(r.targets)) {
            console.log(`  targets/${f}: ${await checkFile(fileBase, authHeader, `images/${itemId}/targets/${f}`)}`);
        }
    }
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
