#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/normalize-logos.js — pad every images/makers/* logo onto the same
// square canvas (contain, centered, transparent padding) so wildly different
// source aspect ratios (0.75 to 2.88 in this collection) stop reading as
// wildly different sizes on screen. Filenames are unchanged — this only
// touches pixel content, so no DB migration is needed.
//
//   node scripts/normalize-logos.js                 # writes into images/makers-normalized/, doesn't touch originals
//   node scripts/normalize-logos.js --apply         # overwrites images/makers/* in place (after you've reviewed the preview)
//   node scripts/normalize-logos.js --size=400       # canvas size in px (default 500)
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT   = path.resolve(__dirname, "..");
const SRC    = path.join(ROOT, "images", "makers");
const OUT    = path.join(ROOT, "images", "makers-normalized");
const APPLY  = process.argv.includes("--apply");
const sizeArg = process.argv.find(a => a.startsWith("--size="));
const SIZE   = sizeArg ? Number(sizeArg.slice(7)) : 500;

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

async function main() {
    const files = fs.readdirSync(SRC).filter(f => IMG_EXT.has(path.extname(f).toLowerCase()));
    console.log(`${files.length} logo file(s), canvas ${SIZE}x${SIZE}, mode: ${APPLY ? "APPLY (overwrite in place)" : "preview (writes to images/makers-normalized/)"}\n`);

    if (!APPLY) fs.mkdirSync(OUT, { recursive: true });

    let ok = 0, failed = 0;
    const renames = {};   // old filename -> new filename, for any extension change (jpg/webp/gif -> png)
    for (const f of files) {
        const src = path.join(SRC, f);
        const dst = APPLY ? src : path.join(OUT, f);
        try {
            const before = await sharp(src).metadata();
            const buf = await sharp(src)
                .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()   // normalize format to PNG so transparency is preserved even for JPEG/webp sources
                .toBuffer();
            const newName = f.replace(/\.(jpe?g|webp|gif)$/i, ".png");
            const outPath = APPLY ? path.join(SRC, newName) : path.join(OUT, newName);
            fs.writeFileSync(outPath, buf);
            if (newName !== f) renames[f] = newName;
            if (APPLY && newName !== f) fs.unlinkSync(src);   // drop the old non-png file once replaced
            console.log(`  ${f.padEnd(42)} ${before.width}x${before.height} (${before.format}) -> ${newName}`);
            ok++;
        } catch (e) {
            console.log(`  ${f.padEnd(42)} FAILED: ${e.message}`);
            failed++;
        }
    }
    console.log(`\n${ok} normalized${failed ? `, ${failed} failed` : ""}.`);
    if (Object.keys(renames).length) {
        const mapPath = path.join(ROOT, "scripts", "logo-renames.json");
        fs.writeFileSync(mapPath, JSON.stringify(renames, null, 2) + "\n");
        console.log(`${Object.keys(renames).length} file(s) changed extension (not PNG originally) — map written to ${mapPath}.`);
        console.log(`Feed that into scripts/normalize-logo-paths.js to update items.maker_logo to match.`);
    }
    if (!APPLY) console.log(`Preview written to ${OUT} — review, then re-run with --apply.`);
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
