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

// ── low-level API calls ──────────────────────────────────────────────────────

// GET /api/db/table — returns every row of one table as an array of objects.
async function dbTable(table) {
    const url = `${DB_API_BASE}/table?table=${encodeURIComponent(table)}`
              + `&rowsAsObjects=true&limit=1000000`;
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
            content:   purchase.content  || "",
            price:     purchase.price    || "",
            location:  purchase.location || "",
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

        return items.map(item => shapeFirearm(item, childMaps));
    } catch (err) {
        if (typeof window !== "undefined" && window.DB_NO_FALLBACK) throw err;
        console.warn(
            `[db.js] Database API unreachable (${err.message}). ` +
            `Falling back to ${DB_FALLBACK_URL} — data may be stale, editing disabled.`
        );
        const res = await fetch(DB_FALLBACK_URL);
        if (!res.ok) {
            throw new Error(`Fallback ${DB_FALLBACK_URL} failed too: ${res.status}`);
        }
        return await res.json();
    }
}
