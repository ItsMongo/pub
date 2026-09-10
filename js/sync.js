// ─────────────────────────────────────────────────────────────────────────────
// sync.js — "Sync Data" : move edits between devices that each run this app on
// their own SHTTPS+ server + SQLite copy.
//
// PUSH  replays this device's sync_outbox (see js/db.js) onto a target device
//       through its REST API — the same path the Edit buttons use. Incremental
//       and resumable; the target tracks how far each source has replayed in a
//       sync_state row.
// PULL  makes this device match a source: reconcile the five collection tables
//       row-by-row, then bring gallery images for the rows that changed.
//
// Both first write a JSON snapshot of the device about to change into
// <archiveDir>/firearms.<DDMMMYY>.json (config.js), pruned to keepBackups via
// an index.json in that folder.
//
// The webroot data/firearms.db is NOT touched — SHTTPS+ on Android serves from
// its own private copy, so everything goes over the API.
// ─────────────────────────────────────────────────────────────────────────────

const SYNC_COLLECTION_TABLES = [
    ["items",           "item_id"],
    ["transactions",    "transaction_id"],
    ["load_data",       "load_id"],
    ["range_notes",     "range_id"],
    ["service_history", "service_id"],
];

// ── small helpers ───────────────────────────────────────────────────────────

const MONTHS3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function ddmmmyy(d = new Date()) {
    return String(d.getDate()).padStart(2, "0") + MONTHS3[d.getMonth()] +
        String(d.getFullYear() % 100).padStart(2, "0");
}
const hhmm = (d = new Date()) =>
    String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
const sqlStr = (s) => String(s).replace(/'/g, "''");
const nowIso = () => new Date().toISOString();

// gzip + base64 a string (SHTTPS+ POST bodies have a size ceiling; a full
// snapshot is ~250 KB raw, ~30 KB packed). Returns null if the browser has no
// CompressionStream — caller then stores the raw JSON.
async function gzipB64(str) {
    if (typeof CompressionStream === "undefined") return null;
    try {
        const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 8192) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return btoa(bin);
    } catch { return null; }
}

// SHTTPS+'s CORS preflight lists methods lowercase ("get, post, put"), which
// browsers reject for PUT/DELETE (they compare against the uppercase request
// method). So sync uses ONLY GET and POST: reads via /api/db/table, and every
// write as SQL through POST /api/db/query. These helpers build that SQL.
const sqlLit = (v) => v === null || v === undefined ? "NULL"
    : typeof v === "number" ? String(v)
    : `'${String(v).replace(/'/g, "''")}'`;

// dbFilters shape ({ clauses:["col="], args:[v] }) -> " WHERE ..." (sync only
// ever uses "=" filters).
function filtersToWhere(f) {
    if (!f || !(f.clauses || []).length) return "";
    const parts = f.clauses.map((cl, i) => `"${cl.replace(/[=<>!?[\]]+$/, "")}" = ${sqlLit(f.args[i])}`);
    return " WHERE " + parts.join(" AND ");
}

const valuesToSet = (values) =>
    Object.entries(values).map(([k, v]) => `"${k}" = ${sqlLit(v)}`).join(", ");

// { columns, data } (SHTTPS+ query shape) -> array of row objects.
function rowsFromQuery(res) {
    const cols = res?.columns || [];
    return (res?.data || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}
const firstCell = (res) => (res?.data && res.data[0] ? res.data[0][0] : undefined);

// Compare two row objects over the union of their keys (loose — DB round-trips
// numbers to strings). null / "" / undefined all read as empty.
function sameRow(a, b) {
    const norm = (v) => (v === null || v === undefined) ? "" : String(v);
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) if (norm(a[k]) !== norm(b[k])) return false;
    return true;
}

// ── REST client (one shape for local same-origin and a remote target) ────────

function makeClient(base, creds) {
    const root = (base || "").replace(/\/+$/, "");            // "" = same origin
    const auth = creds && creds.user
        ? { Authorization: "Basic " + btoa(`${creds.user}:${creds.pass || ""}`) }
        : {};
    const form = { "Content-Type": "application/x-www-form-urlencoded" };

    async function raw(path, opts = {}) {
        let res;
        try {
            res = await fetch(root + path, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
        } catch (e) {
            throw new Error(`can't reach ${root || "this device"} (${e.message}) — check the address, that the server is up, and CORS`);
        }
        if (!res.ok) {
            const body = (await res.text().catch(() => "")).slice(0, 200);
            let msg;
            if (res.status === 401) {
                msg = `401 Unauthorized from ${root || "this device"} — the username / password for this ` +
                      `target were missing or wrong. Type them in the panel (the server itself is reachable).`;
            } else if (res.status === 403) {
                msg = `403 from ${root || "this device"} — signed in but not allowed. In SHTTPS+ enable ` +
                      `"call custom SQL" + "modify tables data" and grant this user those rights.`;
            } else {
                msg = `${opts.method || "GET"} ${path} → ${res.status} ${res.statusText}${body ? " — " + body : ""}`;
            }
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return res;
    }

    return {
        root,
        base: root || "(this device)",

        // Reachability + auth check in one: the query endpoint needs a valid
        // login (a plain GET may not), so this catches bad credentials up front.
        async ping() {
            await raw(`/api/db/query?includeNames=true&limit=1&offset=0`,
                { method: "POST", headers: { "Content-Type": "text/plain" }, body: "SELECT 1" });
        },
        async rows(table) {
            const r = await raw(`/api/db/table?table=${encodeURIComponent(table)}&rowsAsObjects=true&limit=1000000`);
            const b = await r.json();
            return Array.isArray(b) ? b : (b.data || []);
        },
        async sql(text) {
            const r = await raw(`/api/db/query?includeNames=true&limit=1000000&offset=0`,
                { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
            return r.json().catch(() => ({}));
        },
        // POST is fine cross-origin; the /insert endpoint keeps type coercion
        // (JSON values) that raw SQL would lose, so use it for inserts.
        insert(table, values) {
            return raw(`/api/db/insert`, { method: "POST", headers: form,
                body: new URLSearchParams({ table, values: JSON.stringify(values) }) });
        },
        // update / delete as SQL through POST — the PUT and DELETE methods fail
        // the CORS preflight (see note above).
        update(table, values, filters) {
            return this.sql(`UPDATE "${table}" SET ${valuesToSet(values)}${filtersToWhere(filters)}`);
        },
        del(table, filters) {
            return this.sql(`DELETE FROM "${table}"${filtersToWhere(filters)}`);
        },
        async downloadBlob(path) {
            const r = await raw(`/api/file/download?path=${encodeURIComponent(path)}&_=${Date.now()}`);
            return r.blob();
        },
        async downloadJson(path) {
            const r = await raw(`/api/file/download?path=${encodeURIComponent(path)}&_=${Date.now()}`);
            return r.json();
        },
        // Mirrors js/db.js uploadFile: ?path= is the FIRST path segment only
        // (e.g. "images", "archive", "data") and the rest rides in the multipart
        // part filename, which SHTTPS+ turns into folders. An encoded slash in
        // ?path= makes some SHTTPS+ builds error without CORS headers → the
        // browser then reports it as "Failed to fetch".
        async uploadBlob(destDir, relName, blob) {
            const full  = destDir ? `${destDir}/${relName}` : relName;
            const slash = full.indexOf("/");
            const top   = slash === -1 ? "" : full.slice(0, slash);
            const part  = slash === -1 ? full : full.slice(slash + 1);
            const fd = new FormData();
            fd.append("files[]", blob, part);
            await raw(`/api/file/upload?path=${encodeURIComponent(top)}`, { method: "PUT", body: fd });
        },
        async deleteFilesIn(dir, files) {
            if (!files.length) return;
            await raw(`/api/file/delete`, { method: "DELETE", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: dir, files }) });
        },
    };
}

// ── outbox / schema ─────────────────────────────────────────────────────────

async function syncPendingCount() {
    if (typeof isDbLive !== "function" || !isDbLive()) return 0;
    try {
        const local = makeClient("");
        const res = await local.sql("SELECT COUNT(*) FROM sync_outbox WHERE synced = 0");
        return Number(firstCell(res)) || 0;
    } catch { return 0; }
}

async function ensureRemoteSyncSchema(remote) {
    for (const sql of SYNC_DDL) await remote.sql(sql);
    for (const t of UID_TABLES) {
        let hasCol = false;
        try {
            const info = rowsFromQuery(await remote.sql(`PRAGMA table_info("${t}")`));
            hasCol = info.some(c => c.name === "sync_uid");
        } catch { /* PRAGMA blocked — fall through and try the ALTER */ }
        if (!hasCol) {
            try { await remote.sql(`ALTER TABLE "${t}" ADD COLUMN sync_uid TEXT`); } catch { /* raced */ }
        }
    }
}

// ── snapshot backup ─────────────────────────────────────────────────────────
//
// The reliable copy is a row in sync_snapshot (needs only /api/db, which has
// solid CORS). We ALSO try to drop the same JSON as a dated file in archiveDir,
// but the file API's CORS is unreliable across SHTTPS+ builds, so that part is
// best-effort and never blocks the sync.

async function snapshot(client, label, log) {
    const cfg = getConfig();
    const host = getConfig().hostId || "unknown";
    const dump = { _meta: { app: "firearms-collection", label, ts: nowIso(), from: client.root || "local", host } };
    for (const [t] of SYNC_COLLECTION_TABLES) dump[t] = await client.rows(t);
    const json = JSON.stringify(dump);

    // 1. the dependable one — a DB row (packed if the browser can)
    const packed = await gzipB64(json);
    const stored = packed || json;
    await client.insert("sync_snapshot", {
        ts: nowIso(), label, source_host: host,
        enc: packed ? "gzip+b64" : "json", payload: stored,
    });
    const keep = cfg.keepBackups > 0 ? cfg.keepBackups : 30;
    try {
        await client.sql(
            `DELETE FROM sync_snapshot WHERE id NOT IN ` +
            `(SELECT id FROM sync_snapshot ORDER BY id DESC LIMIT ${keep})`);
    } catch { /* prune is housekeeping */ }
    log(`backup → sync_snapshot row (${(stored.length / 1024).toFixed(0)} KB${packed ? " packed" : ""})`);

    // 2. the nice-to-have — a dated file. Time in the name keeps it unique, so
    // there's no need to probe for collisions (that probe was the stray 404 in
    // the logs). Pure best-effort: the file API may not answer cross-origin.
    const dir  = cfg.archiveDir || "archive/database";
    const name = `firearms.${ddmmmyy()}-${hhmm()}.json`;
    try {
        await client.uploadBlob(dir, name, new Blob([json], { type: "application/json" }));
        log(`backup file → ${dir}/${name}`);
    } catch (err) {
        log(`(dated file backup skipped — ${err.message.slice(0, 60)}; the sync_snapshot row is the backup)`);
    }
    return name;
}

// Regenerate <client>/data/firearms.json (the offline read-only fallback) from
// the current rows, so it stops going stale.
async function refreshFallback(client, log) {
    try {
        const tbls = {};
        for (const [t] of SYNC_COLLECTION_TABLES) tbls[t] = await client.rows(t);
        const shaped = shapeCollection(tbls);
        await client.uploadBlob("data", "firearms.json",
            new Blob([JSON.stringify(shaped)], { type: "application/json" }));
        log(`refreshed data/firearms.json (${shaped.length} items)`);
    } catch (err) {
        log(`note: could not refresh data/firearms.json (${err.message})`);
    }
}

// ── PUSH ────────────────────────────────────────────────────────────────────

// Rewrite an int-PK filter on a uid table to a sync_uid filter, resolving the
// uid from this device's own row. Legacy rows (no uid) keep the int filter —
// their ids still line up because both devices seeded from the same export.
async function translateFilter(payload, local) {
    const f = payload.filters;
    if (!UID_TABLES.has(payload.table) || !f || (f.clauses || []).length !== 1) return f;
    const m = /^(load_id|range_id|service_id)=$/.exec(f.clauses[0]);
    if (!m) return f;
    const res = await local.sql(
        `SELECT sync_uid FROM "${payload.table}" WHERE ${m[1]} = ${Number(f.args[0])}`);
    const uid = firstCell(res);
    return uid ? { clauses: ["sync_uid="], args: [uid] } : f;
}

// Is this insert's row already on the target? Keeps replay idempotent without a
// per-source high-water mark, so a retried push can't double-insert.
async function remoteHasRow(remote, table, values) {
    let where;
    if (table === "items") {
        where = `item_id = '${sqlStr(values.item_id)}'`;
    } else if (UID_TABLES.has(table) && values.sync_uid) {
        where = `sync_uid = '${sqlStr(values.sync_uid)}'`;
    } else if (table === "transactions") {
        const w = [`item_id = '${sqlStr(values.item_id)}'`,
                   `transaction_type = '${sqlStr(values.transaction_type)}'`];
        if (values.source) w.push(`source = '${sqlStr(values.source)}'`);
        where = w.join(" AND ");
    } else {
        return false;
    }
    return !!firstCell(await remote.sql(`SELECT 1 FROM "${table}" WHERE ${where} LIMIT 1`));
}

async function applyOp(row, remote, local, log) {
    const p = JSON.parse(row.payload);
    if (row.kind === "db.insert") {
        if (await remoteHasRow(remote, p.table, p.values)) { log(`   (row already on target)`); return; }
        return remote.insert(p.table, p.values);
    }
    if (row.kind === "db.update") {
        return remote.update(p.table, p.values, await translateFilter(p, local));
    }
    if (row.kind === "db.delete") {
        return remote.del(p.table, await translateFilter(p, local));
    }
    if (row.kind === "file.put") {
        const blob = await local.downloadBlob(p.path).catch(() => null);
        if (!blob) { log(`   (local file gone: ${p.path} — skipped)`); return; }
        return remote.uploadBlob("", p.path, blob);        // uploadBlob splits off the top segment
    }
    if (row.kind === "file.del") {
        return remote.deleteFilesIn(p.dir, p.files);
    }
    throw new Error(`unknown op "${row.kind}"`);
}

async function pushToTarget(target, creds, log) {
    const remote = makeClient(target.base, creds);
    const local  = makeClient("");
    const host   = getConfig().hostId || "unknown";

    log(`target ${target.base}`);
    await remote.ping();
    log("connected");
    await ensureRemoteSyncSchema(remote);

    const pending = rowsFromQuery(await local.sql(
        "SELECT seq, kind, tbl, payload FROM sync_outbox WHERE synced = 0 ORDER BY seq"));
    if (!pending.length) { log("outbox empty — nothing to push"); return { pushed: 0 }; }
    log(`${pending.length} change(s) queued`);

    await snapshot(remote, "pre-push", log);

    const dbOps   = pending.filter(r => r.kind.startsWith("db."));
    const fileOps = pending.filter(r => r.kind.startsWith("file."));
    let pushed = 0;

    // ── DB changes: ordered, and a failure stops the run (it's a real problem).
    for (const r of dbOps) {
        const p = JSON.parse(r.payload);
        try {
            await applyOp(r, remote, local, log);
            log(`#${r.seq} ${r.kind} ${r.tbl || ""}`);
            await markSynced(local, Number(r.seq));
            pushed++;
        } catch (err) {
            log(`#${r.seq} FAILED — ${err.message}`);
            throw new Error(`stopped at change #${r.seq} (${r.kind}); ${pushed} applied. Fix, then Sync again.`);
        }
    }

    // ── Image files: best-effort. The target's file API is often not reachable
    // cross-origin; a deferred file stays queued and retries next push.
    const lastPut = new Map();
    for (const r of fileOps) {
        if (r.kind === "file.put") lastPut.set(JSON.parse(r.payload).path, r.seq);
    }
    const deferred = [];
    for (const r of fileOps) {
        const p = JSON.parse(r.payload);
        if (r.kind === "file.put" && lastPut.get(p.path) !== r.seq) {
            await markSynced(local, Number(r.seq));           // superseded by a later write
            continue;
        }
        try {
            await applyOp(r, remote, local, log);
            log(`#${r.seq} ${r.kind} ${p.path || p.dir || ""}`);
            await markSynced(local, Number(r.seq));
            pushed++;
        } catch (err) {
            deferred.push(p.path || `${p.dir}/*`);
            log(`#${r.seq} deferred — ${err.message.slice(0, 60)}`);
        }
    }

    // sync_state: informational only now (idempotent replay guards double-apply).
    try {
        const maxSeq = Math.max(0, ...pending.map(r => Number(r.seq)));
        if (rowsFromQuery(await remote.sql(
                `SELECT 1 FROM sync_state WHERE source_host = '${sqlStr(host)}'`)).length) {
            await remote.update("sync_state", { last_seq: maxSeq, updated_ts: nowIso() },
                { clauses: ["source_host="], args: [host] });
        } else {
            await remote.insert("sync_state", { source_host: host, last_seq: maxSeq, updated_ts: nowIso() });
        }
    } catch { /* not essential */ }

    await refreshFallback(remote, log);

    if (deferred.length) {
        log(`⚠ ${deferred.length} image file(s) could not upload to ${target.base} — still queued, will retry.`);
        log(`  the target's SHTTPS+ file API isn't allowing cross-device requests (see docs/sync.md).`);
    }
    log(`pushed ${pushed} change(s)${deferred.length ? `; ${deferred.length} image file(s) pending` : ""}`);
    return { pushed, deferred: deferred.length };
}

async function markSynced(local, seq) {
    await local.sql(`UPDATE sync_outbox SET synced = 1, synced_ts = '${nowIso()}' WHERE seq = ${seq}`);
}

// ── PULL ────────────────────────────────────────────────────────────────────

function keyOf(table, row) {
    if (table === "items") return "id:" + row.item_id;
    if (table === "transactions") {
        return "tx:" + row.item_id + "|" + row.transaction_type + "|" + (row.source || "");
    }
    return row.sync_uid ? "uid:" + row.sync_uid : "pk:" + row[uidPk(table)];
}
const uidPk = (t) => ({ load_data: "load_id", range_notes: "range_id", service_history: "service_id" }[t]);

async function pullFromTarget(target, creds, log) {
    const remote = makeClient(target.base, creds);
    const local  = makeClient("");

    log(`source ${target.base}`);
    await remote.ping();
    log("connected");

    await snapshot(local, "pre-pull", log);

    const touched = new Set();     // item_ids whose gallery should be refreshed

    for (const [table] of SYNC_COLLECTION_TABLES) {
        const [src, dst] = await Promise.all([remote.rows(table), local.rows(table)]);
        const srcByKey = new Map(src.map(r => [keyOf(table, r), r]));
        const dstByKey = new Map(dst.map(r => [keyOf(table, r), r]));
        let ins = 0, upd = 0, del = 0;

        // Deletes first, so a divergent local row frees its integer PK before
        // the matching source row is inserted at that same PK.
        for (const [k, r] of dstByKey) {
            if (srcByKey.has(k)) continue;
            await local.del(table, updateKeyFilter(table, r)); del++;
            if (r.item_id) touched.add(r.item_id);
        }
        for (const [k, r] of srcByKey) {
            const cur = dstByKey.get(k);
            if (!cur) {
                await local.insert(table, r); ins++;
                if (r.item_id) touched.add(r.item_id);
            } else if (!sameRow(cur, r)) {
                const vals = { ...r }; delete vals[pkOf(table)];
                await local.update(table, vals, updateKeyFilter(table, cur)); upd++;
                if (r.item_id) touched.add(r.item_id);
            }
        }
        log(`${table}: +${ins} ~${upd} -${del}`);
    }

    await pullImages(remote, local, touched, log);

    // Local outbox is now void — this device mirrors the source.
    await local.sql(`UPDATE sync_outbox SET synced = 1, synced_ts = '${nowIso()}' WHERE synced = 0`);
    await refreshFallback(local, log);

    log(`pulled — ${touched.size} item(s) touched`);
    return { touched: touched.size };
}

const pkOf = (t) => ({
    items: "item_id", transactions: "transaction_id",
    load_data: "load_id", range_notes: "range_id", service_history: "service_id",
}[t]);

function updateKeyFilter(table, row) {
    if (table === "items") return { clauses: ["item_id="], args: [row.item_id] };
    if (table === "transactions") {
        const c = ["item_id=", "transaction_type="], a = [row.item_id, row.transaction_type];
        if (row.source) { c.push("source="); a.push(row.source); }
        return { clauses: c, args: a };
    }
    if (row.sync_uid) return { clauses: ["sync_uid="], args: [row.sync_uid] };
    return { clauses: [uidPk(table) + "="], args: [row[uidPk(table)]] };
}

// Bring gallery images for the touched items, plus any whose manifest differs.
async function pullImages(remote, local, touched, log) {
    const items = await local.rows("items");
    let changed = 0;
    for (const it of items) {
        const id = it.item_id;
        const rList = await remote.downloadJson(`images/${id}/images.json`).catch(() => null);
        if (!Array.isArray(rList)) continue;
        const lList = await local.downloadJson(`images/${id}/images.json`).catch(() => null) || [];
        const differs = touched.has(id) || rList.length !== lList.length ||
            rList.some((n, i) => n !== lList[i]);
        if (!differs) continue;

        for (const name of rList) {
            const blob = await remote.downloadBlob(`images/${id}/${name}`).catch(() => null);
            if (blob) await local.uploadBlob(`images/${id}`, name, blob);
        }
        await local.uploadBlob(`images/${id}`, "images.json",
            new Blob([JSON.stringify(rList)], { type: "application/json" }));
        const extras = lList.filter(n => !rList.includes(n));
        if (extras.length) await local.deleteFilesIn(`images/${id}`, extras).catch(() => {});
        changed++;
    }
    log(`images: ${changed} gallery/galleries updated`);
}

// ── panel ───────────────────────────────────────────────────────────────────

let _syncBusy = false;

async function openSyncPanel() {
    await configReady;
    const cfg = getConfig();

    document.getElementById("syncPanel")?.remove();

    const panel = el("div", "modal", { id: "syncPanel" });
    const box   = el("div", "modal-box sync-box");
    panel.appendChild(box);

    const head = el("div", "sync-head");
    head.append(el("span", null, {}, "Sync Data"));
    const close = el("button", "im-close", { type: "button" }, "✕");
    close.onclick = () => panel.remove();
    head.appendChild(close);
    box.appendChild(head);

    if (!cfg.syncTargets.length) {
        box.appendChild(el("p", "sync-note", {},
            "No sync targets. Add one to config.json: syncTargets: [{ name, hostId, base }]."));
        document.body.appendChild(panel);
        return;
    }

    // Target picker
    const tgtWrap = el("label", "sync-field", {}, "Target");
    const tgtSel  = el("select", null, { id: "syncTarget" });
    cfg.syncTargets.forEach((t, i) => {
        const o = new Option(isSourceHost(t) ? `${t.name} — this device` : t.name, String(i));
        tgtSel.appendChild(o);
    });
    tgtWrap.appendChild(tgtSel);
    box.appendChild(tgtWrap);

    const note   = el("div", "sync-note", { id: "syncSourceNote", hidden: true });
    box.appendChild(note);

    // Credentials
    const creds  = el("div", "sync-creds", { id: "syncCreds" });
    const userIn = el("input", null, { type: "text", id: "syncUser", autocomplete: "off", placeholder: "username (blank if none)" });
    const passIn = el("input", null, { type: "password", id: "syncPass", autocomplete: "off", placeholder: "password" });
    const remember = el("input", null, { type: "checkbox", id: "syncRemember" });

    const userLabel = el("label", "sync-field", {}, "Username");
    userLabel.appendChild(userIn);
    const passLabel = el("label", "sync-field", {}, "Password");
    passLabel.appendChild(passIn);
    const rememberWrap = el("label", "sync-check");
    rememberWrap.append(remember, document.createTextNode(" Remember on this device"));

    creds.append(userLabel, passLabel, rememberWrap);
    box.appendChild(creds);

    const summary = el("div", "sync-summary", { id: "syncSummary" });
    box.appendChild(summary);

    const actions = el("div", "sync-actions");
    const pushBtn = el("button", "im-save", { type: "button" }, "Push →");
    const pullBtn = el("button", "im-save sync-pull", { type: "button" }, "← Pull");
    actions.append(pushBtn, pullBtn);
    box.appendChild(actions);

    const logBox = el("pre", "sync-log", { id: "syncLog", hidden: true });
    box.appendChild(logBox);

    const log = (line) => {
        logBox.hidden = false;
        logBox.textContent += (logBox.textContent ? "\n" : "") + line;
        logBox.scrollTop = logBox.scrollHeight;
    };

    function currentTarget() { return cfg.syncTargets[Number(tgtSel.value)]; }

    // Fill the credential fields from config — only when the target changes, so
    // a value the user just typed is never wiped by a state refresh.
    function loadCredsFromConfig() {
        const t = currentTarget();
        userIn.value = t.user || "";
        passIn.value = t.pass || "";
    }

    async function refreshState() {
        const t = currentTarget();
        const isSource = isSourceHost(t);
        note.hidden = !isSource;
        note.textContent = isSource
            ? "This device is the source for that target — its edits are already live there."
            : "";
        creds.hidden = isSource;
        pushBtn.disabled = pullBtn.disabled = isSource || _syncBusy;
        const n = await syncPendingCount();
        summary.textContent = isSource
            ? ""
            : `${n} unsynced change${n === 1 ? "" : "s"} on this device` +
              (outboxHealth().degraded ? `  •  ⚠ ${outboxHealth().degraded} change(s) failed to queue` : "");
    }

    tgtSel.onchange = () => { loadCredsFromConfig(); refreshState(); };
    loadCredsFromConfig();

    async function run(kind) {
        if (_syncBusy) return;
        const t = currentTarget();
        const c = { user: userIn.value.trim(), pass: passIn.value };
        if (remember.checked) {
            t.user = c.user; t.pass = c.pass;
            saveConfig(cfg).then(ok => log(ok ? "saved credentials to config.json" : "note: could not write config.json"));
        }
        if (kind === "pull") {
            const n = await syncPendingCount();
            if (n > 0 && !confirm(
                `This device has ${n} change(s) not yet pushed.\n` +
                `Pull overwrites local data with the source and voids those changes.\n\nContinue?`)) {
                return;
            }
        } else {
            if (!confirm(`Push this device's changes to ${t.name} (${t.base})?\nA dated backup of the target is made first.`)) return;
        }

        _syncBusy = true;
        pushBtn.disabled = pullBtn.disabled = true;
        logBox.hidden = false; logBox.textContent = "";
        log(`${kind === "pull" ? "PULL" : "PUSH"} — ${new Date().toLocaleString()}`);
        try {
            const res = kind === "pull"
                ? await pullFromTarget(t, c, log)
                : await pushToTarget(t, c, log);
            log("done.");
            if (kind === "pull") {
                log("reloading…");
                await loadData();
            }
        } catch (err) {
            log("");
            log("ERROR: " + err.message);
        } finally {
            _syncBusy = false;
            await refreshState();
            updateSyncButton();
        }
    }

    pushBtn.onclick = () => run("push");
    pullBtn.onclick = () => run("pull");

    panel.addEventListener("click", (e) => { if (e.target === panel) panel.remove(); });
    document.body.appendChild(panel);
    await refreshState();
}

// tiny DOM helper
function el(tag, cls, attrs, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const [k, v] of Object.entries(attrs || {})) {
        if (k === "hidden") { if (v) n.hidden = true; }
        else n.setAttribute(k, v);
    }
    if (text != null) n.textContent = text;
    return n;
}

// ── header button ───────────────────────────────────────────────────────────

async function updateSyncButton() {
    const btn = document.getElementById("syncDataBtn");
    if (!btn) return;
    await configReady;
    const live = typeof isDbLive === "function" && isDbLive();
    const hasTargets = getConfig().syncTargets.length > 0;
    btn.hidden = !(live && hasTargets);
    if (btn.hidden) return;
    const n = await syncPendingCount();
    btn.textContent = n > 0 ? `⇅ Sync (${n})` : "⇅ Sync";
    btn.classList.toggle("has-pending", n > 0);
}

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("syncDataBtn");
    if (btn) btn.onclick = openSyncPanel;
});
