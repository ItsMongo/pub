#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/push-flags.js — upload images/<subdir>/* to a device's images/<subdir>/
// over the SHTTPS+ file API. For a device you can't reach as a filesystem share
// (a tablet) — the Shield can just have the folder copied/moved directly since
// Z: is a mounted share.
//
//   node scripts/push-flags.js http://192.168.5.42:8080 --user=NAME --pass=SECRET                  # images/flags (default)
//   node scripts/push-flags.js makers http://192.168.5.42:8080 --user=NAME --pass=SECRET           # images/makers
//   node scripts/push-flags.js makers http://192.168.5.42:8080 --user=NAME --pass=SECRET --dry-run
//
// Mirrors the upload shape js/db.js uses for gallery images: PUT
// /api/file/upload?path=images with the part filename carrying the subpath
// ("<subdir>/<name>"), which SHTTPS+ expands into a folder.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("node:fs");
const path = require("node:path");
const { argsFromProcess } = require("./lib/shttps-client");

// First non-flag arg is either the subdir name or (old usage) the URL — tell
// them apart by whether it looks like a URL.
const rawArgs = process.argv.slice(2);
const firstPositional = rawArgs.find(a => !a.startsWith("--"));
const SUBDIR = firstPositional && !/^https?:\/\//i.test(firstPositional) ? firstPositional : "flags";
const a = argsFromProcess(SUBDIR === "flags" ? process.argv : ["node", "push-flags.js", ...rawArgs.filter(x => x !== SUBDIR)]);

const DRY_RUN = a.flags.has("--dry-run");
const ROOT    = path.resolve(__dirname, "..");
const DIR     = path.resolve(ROOT, "images", SUBDIR);

if (!a.base) {
    console.error("Usage:  node scripts/push-flags.js [subdir] http://<device-ip>:8080 --user=NAME --pass=SECRET [--dry-run]");
    console.error("        subdir defaults to \"flags\" (e.g. pass \"makers\" for images/makers)");
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
        fd.append("files[]", new Blob([bytes]), `${SUBDIR}/${f}`);
        const res = await fetch(`${a.base.replace(/\/$/, "")}/api/file/upload?path=images`, {
            method: "PUT", headers: authHeader, body: fd,
        });
        if (res.ok) { ok++; process.stdout.write("."); }
        else { failed++; console.log(`\n  FAILED ${f}: ${res.status} ${await res.text().catch(() => "")}`); }
    }
    console.log(`\n\nUploaded ${ok}/${files.length}${failed ? `, ${failed} FAILED` : ""}.`);
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
