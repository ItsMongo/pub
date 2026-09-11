#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/push-flags.js — upload images/flags/* to a device's images/flags/
// over the SHTTPS+ file API. For a device you can't reach as a filesystem
// share (a tablet) — the Shield can just have the folder copied/moved directly
// since Z: is a mounted share.
//
//   node scripts/push-flags.js http://192.168.5.42:8080 --user=NAME --pass=SECRET
//   node scripts/push-flags.js http://192.168.5.42:8080 --user=NAME --pass=SECRET --dry-run
//
// Mirrors the upload shape js/db.js uses for gallery images: PUT
// /api/file/upload?path=images with the part filename carrying the subpath
// ("flags/<name>"), which SHTTPS+ expands into a folder.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("node:fs");
const path = require("node:path");
const { argsFromProcess } = require("./lib/shttps-client");

const a       = argsFromProcess();
const DRY_RUN = a.flags.has("--dry-run");
const ROOT    = path.resolve(__dirname, "..");
const DIR     = path.resolve(ROOT, "images/flags");

if (!a.base) {
    console.error("Usage:  node scripts/push-flags.js http://<device-ip>:8080 --user=NAME --pass=SECRET [--dry-run]");
    process.exit(1);
}

const authHeader = a.user
    ? { Authorization: "Basic " + Buffer.from(`${a.user}:${a.pass || ""}`).toString("base64") }
    : {};

async function main() {
    const files = fs.readdirSync(DIR).filter(f => !f.startsWith("."));
    console.log(`Source   ${DIR}`);
    console.log(`Target   ${a.base}`);
    console.log(`Files    ${files.length}\n`);

    if (DRY_RUN) {
        for (const f of files) console.log(`  would upload: ${f}`);
        console.log("\n(dry run — nothing sent)");
        return;
    }

    let ok = 0, failed = 0;
    for (const f of files) {
        const bytes = fs.readFileSync(path.join(DIR, f));
        const fd = new FormData();
        fd.append("files[]", new Blob([bytes]), `flags/${f}`);
        const res = await fetch(`${a.base.replace(/\/$/, "")}/api/file/upload?path=images`, {
            method: "PUT", headers: authHeader, body: fd,
        });
        if (res.ok) { ok++; process.stdout.write("."); }
        else { failed++; console.log(`\n  FAILED ${f}: ${res.status} ${await res.text().catch(() => "")}`); }
    }
    console.log(`\n\nUploaded ${ok}/${files.length}${failed ? `, ${failed} FAILED` : ""}.`);
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
