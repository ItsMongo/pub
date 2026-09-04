// ─────────────────────────────────────────────────────────────────────────────
// db.js — data-access layer for the firearms collection
//
// In production the app is served by SHTTPS+ (Simple HTTP Server, PLUS edition),
// which exposes the SQLite file data/firearms.db over a REST API rooted at
// /api/db.  API reference: https://shttps.phlox.dev/api-browser/
//
// Nothing outside this file should talk to the API directly. app.js calls
// loadCollection() and gets back an array of firearm objects in the same shape
// the UI has always used (c.make, c.tabs.history.content, …), so updateUI(),
// loadTabs() and friends did not have to change.
//
// Tables:
//   items            one row per firearm (item_id PK, e.g. "LE41"); also holds
//                    the History-tab fields inline (history_title, …)
//   transactions     transaction_type = 'Purchase'      -> Purchase tab
//                    transaction_type = 'CurrentValue'  -> Market Value tab
//                    (source = 'GunBroker' | 'RockIsland')
//   load_data        Load Data tab
//   range_notes      Range Notes tab
//   service_history  Maintenance tab
// ─────────────────────────────────────────────────────────────────────────────

// Where the DB API lives. The relative default works in production because the
// page and the API share an origin (both served by SHTTPS+ on the Shield).
// For local dev against the Shield instead of the bundled dev server, set
//   window.DB_API_BASE = "http://192.168.1.50:8080/api/db"
// before this script loads (and enable CORS in SHTTPS+ settings).
const DB_API_BASE =
    (typeof window !== "undefined" && window.DB_API_BASE) || "/api/db";

// If the API can't be reached, fall back to this JSON snapshot so the page still
// renders (read-only, possibly stale). Set window.DB_NO_FALLBACK to disable.
const DB_FALLBACK_URL = "data/firearms.json";

// True once loadCollection() has read from the live API. Editing is only
// possible when this is true (the JSON fallback is read-only).
let dbLive = false;
function isDbLive() { return dbLive; }

// SHTTPS+ filter object: column names carry an operator suffix, values are bound.
//   dbFilters({ item_id: "LE41", transaction_type: "Purchase" })
//   -> { clauses: ["item_id=", "transaction_type="], args: ["LE41", "Purchase"] }
function dbFilters(equals) {
    const clauses = [], args = [];
    for (const [col, val] of Object.entries(equals)) {
        clauses.push(col + "=");
        args.push(val);
    }
    return { clauses, args };
}

// ── low-level API calls ──────────────────────────────────────────────────────

// GET /api/db/table — returns rows of one table as an array of objects.
// Pass `filters` (a dbFilters() object) to restrict to matching rows.
async function dbTable(table, filters) {
    let url = `${DB_API_BASE}/table?table=${encodeURIComponent(table)}`
            + `&rowsAsObjects=true&limit=1000000`;
    if (filters) url += `&filters=${encodeURIComponent(JSON.stringify(filters))}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
        throw new Error(`DB API ${res.status} ${res.statusText} for table "${table}"`);
    }
    const body = await res.json();
    // SHTTPS+ replies { total, data: [...] }; be tolerant of a bare array too.
    return Array.isArray(body) ? body : (body.data || []);
}

// POST /api/db/query — run an arbitrary read-only SQL statement.
// Not used on boot; handy for the edit features to come. Returns row objects.
async function dbQuery(sql, { limit = 100000, offset = 0 } = {}) {
    const url = `${DB_API_BASE}/query?limit=${limit}&offset=${offset}&includeNames=true`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: sql,
    });
    if (!res.ok) throw new Error(`DB query ${res.status}: ${await res.text()}`);
    const { columns, data } = await res.json();
    return data.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

// ── shaping DB rows into the object shape the UI expects ─────────────────────

function groupByItem(rows) {
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.item_id)) map.set(row.item_id, []);
        map.get(row.item_id).push(row);
    }
    return map;
}

function buildTabs(item, kids) {
    const purchase      = kids.transactions.find(t => t.transaction_type === "Purchase");
    const currentValues = kids.transactions.filter(t => t.transaction_type === "CurrentValue");
    const load  = kids.load_data[0];
    const range = kids.range_notes[0];
    const service = kids.service_history[0];

    const marketBySource = {};
    for (const cv of currentValues) {
        if (!cv.source) continue;
        marketBySource[cv.source] = {
            avgValue: cv.price || "",
            url:      cv.url   || "",
            date:     cv.notes || "",
        };
    }

    return {
        history: {
            title:     item.history_title   || "",
            content:   item.history_content || "",
            wikipedia: { url: item.history_wiki_url      || "" },
            gunDigest: { url: item.history_gundigest_url || "" },
        },

        purchase: purchase ? {
            title:     "Purchase History",
            date:      purchase.date     || "",
            content:   purchase.content  || "",
            price:     purchase.price    || "",
            location:  purchase.location || "",
            url:       purchase.url      || "",
            notes:     purchase.notes    || "",
            wikipedia: { url: "" }, gunDigest: { url: "" },
        } : {},

        marketValue: currentValues.length ? {
            title:      "Market Value History:",
            content:    (currentValues.find(cv => cv.content) || {}).content || "",
            GunBroker:  marketBySource.GunBroker,
            RockIsland: marketBySource.RockIsland,
            wikipedia:  { url: "" }, gunDigest: { url: "" },
        } : {},

        loadData: load ? {
            title:     load.title   || "Cartridge Load Data:",
            content:   load.content || "",
            wikipedia: { url: load.source_url || "" }, gunDigest: { url: "" },
        } : {},

        rangeNotes: range ? {
            title:     "Range Visits & Results",
            Date:      range.date           || "",
            Range:     range.range_name     || "",
            Distance:  range.distance_yards || "",
            Ammo:      range.ammo           || "",
            Notes:     range.notes          || "",
            content:   range.content        || "",
            wikipedia: { url: "" }, gunDigest: { url: "" },
        } : {},

        maintenance: service ? {
            title:     "Maintenance & Service",
            content:   [service.date, service.description, service.notes]
                           .filter(Boolean).join("\n\n"),
            wikipedia: { url: "" }, gunDigest: { url: "" },
        } : {},
    };
}

function shapeFirearm(item, childMaps) {
    const kids = {
        load_data:       childMaps.load_data.get(item.item_id)       || [],
        range_notes:     childMaps.range_notes.get(item.item_id)     || [],
        service_history: childMaps.service_history.get(item.item_id) || [],
        transactions:    childMaps.transactions.get(item.item_id)    || [],
    };

    return {
        itemId:         item.item_id,   // stable key — needed by the edit features
        imageID:        item.item_id,   // image folders are named by item_id
        // Raw DB rows (real column names + primary keys) for the edit features.
        // Display code uses `tabs` below; edit code uses `raw`.
        raw:            { item, ...kids },
        type:           item.type              || "",
        make:           item.make              || "",
        model:          item.model             || "",
        year:           item.year,              // may be null; leave as-is
        cartridge:      item.cartridge         || "",
        caliber:        item.caliber           || "",
        COAL:           item.coal              || "",
        cartridgeImage: item.cartridge_image   || "",
        cartridgeWiki:  item.cartridge_wiki_url || "",
        cartWiki2:      item.cart_wiki2        || "",
        feed:           item.feed              || "",
        magCapacity:    item.mag_capacity,      // may be null; leave as-is
        serialNumber:   item.serial_number     || "",
        action:         item.action            || "",
        country:        item.country           || "",
        flag:           item.flag_image        || "",
        optic:          item.optic             || "",
        opticSpec:      item.optic_spec        || "",
        sights:         item.sights            || "",
        sightType:      item.sight_type        || "",
        weight:         item.weight            || "",
        makerLogo:      item.maker_logo        || "",
        note:           item.note              || "",
        tabs:           buildTabs(item, kids),
    };
}

// ── public entry point ──────────────────────────────────────────────────────

async function loadCollection() {
    try {
        const [items, load_data, range_notes, service_history, transactions] =
            await Promise.all([
                dbTable("items"),
                dbTable("load_data"),
                dbTable("range_notes"),
                dbTable("service_history"),
                dbTable("transactions"),
            ]);

        const childMaps = {
            load_data:       groupByItem(load_data),
            range_notes:     groupByItem(range_notes),
            service_history: groupByItem(service_history),
            transactions:    groupByItem(transactions),
        };

        dbLive = true;
        return items.map(item => shapeFirearm(item, childMaps));
    } catch (err) {
        if (typeof window !== "undefined" && window.DB_NO_FALLBACK) throw err;
        console.warn(
            `[db.js] Database API unreachable (${err.message}). ` +
            `Falling back to ${DB_FALLBACK_URL} — data may be stale, editing disabled.`
        );
        dbLive = false;
        const res = await fetch(DB_FALLBACK_URL);
        if (!res.ok) {
            throw new Error(`Fallback ${DB_FALLBACK_URL} failed too: ${res.status}`);
        }
        return await res.json();
    }
}

// ── writes ──────────────────────────────────────────────────────────────────
// The browser sends the viewer's cached Basic credentials / session cookie
// automatically (same origin), so these need no auth handling of their own.

async function dbWrite(endpoint, method, fields) {
    const res = await fetch(`${DB_API_BASE}/${endpoint}`, {
        method,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint} failed (${res.status}): ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return {}; }
}

// POST /api/db/insert — insert one row. `values` is a column→value object.
function dbInsert(table, values) {
    return dbWrite("insert", "POST", { table, values: JSON.stringify(values) });
}

// PUT /api/db/update — update the rows matching `filters` (a dbFilters() object).
function dbUpdate(table, values, filters) {
    return dbWrite("update", "PUT", {
        table,
        values: JSON.stringify(values),
        filters: JSON.stringify(filters),
    });
}

// DELETE /api/db/delete — delete the rows matching `filters`.
function dbDelete(table, filters) {
    return dbWrite("delete", "DELETE", {
        table,
        filters: JSON.stringify(filters),
    });
}

// Re-fetch one firearm's rows and return a freshly shaped object. Call after a
// save so the in-memory copy matches the database.
async function reloadFirearm(itemId) {
    const f = dbFilters({ item_id: itemId });
    const [items, load_data, range_notes, service_history, transactions] =
        await Promise.all([
            dbTable("items", f),
            dbTable("load_data", f),
            dbTable("range_notes", f),
            dbTable("service_history", f),
            dbTable("transactions", f),
        ]);
    if (!items.length) throw new Error(`Firearm "${itemId}" not found after reload`);
    return shapeFirearm(items[0], {
        load_data:       groupByItem(load_data),
        range_notes:     groupByItem(range_notes),
        service_history: groupByItem(service_history),
        transactions:    groupByItem(transactions),
    });
}

// Upsert the single Purchase row for a firearm. `values` holds the editable
// columns (date, price, location, url, content, notes).
async function savePurchase(firearm, values) {
    const existing = (firearm.raw?.transactions || [])
        .find(t => t.transaction_type === "Purchase");
    if (existing) {
        return dbUpdate("transactions", values,
            dbFilters({ item_id: firearm.itemId, transaction_type: "Purchase" }));
    }
    return dbInsert("transactions", {
        item_id: firearm.itemId,
        transaction_type: "Purchase",
        ...values,
    });
}

// Save the Market Value tab: one CurrentValue `transactions` row per source
// (GunBroker, RockIsland), sharing one `summary`.
//
//   - a source row exists iff it has a value, link or note of its own
//   - clearing all three of a source's fields deletes its row
//   - `summary` is mirrored onto whatever source rows survive; it has no home
//     of its own, so a summary with no source data can't be saved
async function saveMarketValue(firearm, summary, sources) {
    const existing = (firearm.raw?.transactions || [])
        .filter(t => t.transaction_type === "CurrentValue");

    const anyData = Object.values(sources).some(s => s.value || s.url || s.note);
    if (summary && !anyData) {
        throw new Error("Add a value or link for GunBroker or Rock Island before saving a summary.");
    }

    for (const [source, s] of Object.entries(sources)) {
        const row  = existing.find(e => e.source === source);
        const has  = !!(s.value || s.url || s.note);
        const filt = dbFilters({
            item_id: firearm.itemId, transaction_type: "CurrentValue", source,
        });
        if (has) {
            const vals = {
                price:   s.value || null,
                url:     s.url   || null,
                notes:   s.note  || null,
                content: summary || null,
            };
            if (row) await dbUpdate("transactions", vals, filt);
            else await dbInsert("transactions", {
                item_id: firearm.itemId, transaction_type: "CurrentValue", source, ...vals,
            });
        } else if (row) {
            await dbDelete("transactions", filt);
        }
    }

    // Keep the shared summary in sync on any CurrentValue rows from other
    // sources that this form does not expose.
    const handled = new Set(Object.keys(sources));
    for (const e of existing) {
        if (e.source && !handled.has(e.source)) {
            await dbUpdate("transactions", { content: summary || null },
                dbFilters({ item_id: firearm.itemId, transaction_type: "CurrentValue", source: e.source }));
        }
    }
}
