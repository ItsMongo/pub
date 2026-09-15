#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/pad-to-canvas.js — fit one image onto a fixed-size canvas (contain,
// centered, padded) so a set of images with wildly different source aspect
// ratios present at consistent visual scale. Used for:
//   - the two historical flags that aren't in flag-icons (no source rename)
//   - the maker-logo normalization pass
//
//   node scripts/pad-to-canvas.js <in> <out> <width> <height> [--bg=transparent|#RRGGBB]
//   node scripts/pad-to-canvas.js images/flags/cccp.png images/flags/soviet-union.png 640 480
// ─────────────────────────────────────────────────────────────────────────────

const sharp = require("sharp");

const [, , input, output, wArg, hArg, ...rest] = process.argv;
if (!input || !output || !wArg || !hArg) {
    console.error("Usage: node scripts/pad-to-canvas.js <in> <out> <width> <height> [--bg=transparent|#RRGGBB]");
    process.exit(1);
}
const width  = Number(wArg);
const height = Number(hArg);
const bgArg  = (rest.find(a => a.startsWith("--bg=")) || "--bg=transparent").slice(5);
const background = bgArg === "transparent" ? { r: 0, g: 0, b: 0, alpha: 0 } : bgArg;

sharp(input)
    .resize(width, height, { fit: "contain", background })
    .toFile(output)
    .then(info => console.log(`${input} -> ${output}  (${info.width}x${info.height}, ${info.size}b)`))
    .catch(e => { console.error("FAILED:", e.message); process.exit(1); });
