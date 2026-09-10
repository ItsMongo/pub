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
const sqlStr = (s) => String(s).replace(/'/g, "''");
const nowIso = () => new Date().toISOString();

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
            const err = new Error(`${opts.method || "GET"} ${path} → ${res.status} ${res.statusText}${body ? " — " + body : ""}`);
            err.status = res.status;
            throw err;
        }
        return res;
    }

    return {
        root,
        base: root || "(this device)",

        async ping() {
            await raw(`/api/db/table?table=items&rowsAsObjects=true&limit=1`);
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
        insert(table, values) {
            return raw(`/api/db/insert`, { method: "POST", headers: form,
                body: new URLSearchParams({ table, values: JSON.stringify(values) }) });
        },
        update(table, values, filters) {
            return raw(`/api/db/update`, { method: "PUT", headers: form,
                body: new URLSearchParams({ table, values: JSON.stringify(values), filters: JSON.stringify(filters) }) });
        },
        del(table, filters) {
            return raw(`/api/db/delete`, { method: "DELETE", headers: form,
                body: new URLSearchParams({ table, filters: JSON.stringify(filters) }) });
        },
        async downloadBlob(path) {
            const r = await raw(`/api/file/download?path=${encodeURIComponent(path)}&_=${Date.now()}`);
            return r.blob();
        },
        async downloadJson(path) {
            const r = await raw(`/api/file/download?path=${encodeURIComponent(path)}&_=${Date.now()}`);
            return r.json();
        },
        async uploadBlob(destDir, relName, blob) {
            const fd = new FormData();
            fd.append("files[]", blob, relName);
            await raw(`/api/file/upload?path=${encodeURIComponent(destDir)}`, { method: "PUT", body: fd });
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

async function snapshot(client, label, log) {
    const cfg = getConfig();
    const dir = cfg.archiveDir || "archive/database";
    const dump = { _meta: { app: "firearms-collection", label, ts: nowIso(), from: client.root || "local" } };
    for (const [t] of SYNC_COLLECTION_TABLES) dump[t] = await client.rows(t);

    const stem = `firearms.${ddmmmyy()}`;
    let name = `${stem}.json`;
    for (let i = 2; i <= 50; i++) {
        const taken = await client.downloadJson(`${dir}/${name}`).then(() => true).catch(() => false);
        if (!taken) break;
        name = `${stem}-${i}.json`;
    }
    await client.uploadBlob(dir, name, new Blob([JSON.stringify(dump)], { type: "application/json" }));
    log(`backup → ${dir}/${name}`);
    await pruneBackups(client, dir, name, label, cfg.keepBackups, log);
    return name;
}

// No "list directory" in the API, so track snapshots in an index.json.
async function pruneBackups(client, dir, addedName, label, keep, log) {
    let index = [];
    try { index = await client.downloadJson(`${dir}/index.json`); } catch { /* first run */ }
    if (!Array.isArray(index)) index = [];
    index.push({ name: addedName, ts: nowIso(), label });
    index.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

    if (keep > 0 && index.length > keep) {
        const drop = index.splice(0, index.length - keep);
        try { await client.deleteFilesIn(dir, drop.map(e => e.name)); } catch { /* ignore */ }
        log(`pruned ${drop.length} old backup(s)`);
    }
    try {
        await client.uploadBlob(dir, "index.json", new Blob([JSON.stringify(index, null, 1)], { type: "application/json" }));
    } catch { /* index is a convenience, not critical */ }
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

async function applyOp(row, remote, local, log) {
    const p = JSON.parse(row.payload);
    if (row.kind === "db.insert") {
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
        const slash = p.path.indexOf("/");                 // "images" / "<rest>"
        return remote.uploadBlob(p.path.slice(0, slash), p.path.slice(slash + 1), blob);
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

    const stateRows = rowsFromQuery(await remote.sql(
        `SELECT last_seq FROM sync_state WHERE source_host = '${sqlStr(host)}'`));
    const lastSeq = Number(stateRows[0]?.last_seq) || 0;
    const haveState = stateRows.length > 0;
    if (!haveState) {
        await remote.insert("sync_state", { source_host: host, last_seq: 0, updated_ts: nowIso() });
    }

    // For repeated file.put on one path, only the last write matters.
    const lastPut = new Map();
    for (const r of pending) {
        if (r.kind !== "file.put") continue;
        lastPut.set(JSON.parse(r.payload).path, r.seq);
    }

    let pushed = 0, skipped = 0;
    for (const r of pending) {
        const seq = Number(r.seq);
        if (seq <= lastSeq) { await markSynced(local, seq); skipped++; continue; }
        const p = JSON.parse(r.payload);
        try {
            if (r.kind === "file.put" && lastPut.get(p.path) !== r.seq) {
                log(`#${seq} superseded ${p.path}`);
            } else {
                await applyOp(r, remote, local, log);
                log(`#${seq} ${r.kind}${r.tbl ? " " + r.tbl : ""}${p.path ? " " + p.path : ""}`);
            }
            await remote.update("sync_state", { last_seq: seq, updated_ts: nowIso() },
                { clauses: ["source_host="], args: [host] });
            await markSynced(local, seq);
            pushed++;
        } catch (err) {
            log(`#${seq} FAILED — ${err.message}`);
            throw new Error(`stopped at change #${seq} (${r.kind}); ${pushed} applied. Fix, then Sync again.`);
        }
    }
    if (skipped) log(`${skipped} already on target`);
    await refreshFallback(remote, log);
    log(`pushed ${pushed} change(s)`);
    return { pushed };
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

    async function refreshState() {
        const t = currentTarget();
        const isSource = isSourceHost(t);
        note.hidden = !isSource;
        note.textContent = isSource
            ? "This device is the source for that target — its edits are already live there."
            : "";
        creds.hidden = isSource;
        pushBtn.disabled = pullBtn.disabled = isSource || _syncBusy;
        userIn.value = t.user || "";
        passIn.value = t.pass || "";
        const n = await syncPendingCount();
        summary.textContent = isSource
            ? ""
            : `${n} unsynced change${n === 1 ? "" : "s"} on this device` +
              (outboxHealth().degraded ? `  •  ⚠ ${outboxHealth().degraded} change(s) failed to queue` : "");
    }

    tgtSel.onchange = refreshState;

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
