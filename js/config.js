// ─────────────────────────────────────────────────────────────────────────────
// config.js — device configuration (config.json in the web root)
//
// Each device that serves this app gets its own config.json. It is loaded once
// at boot and drives the Sync feature (js/sync.js):
//
//   {
//     "hostId": "tablet",                 // this device's identity
//     "syncTargets": [                    // where "Sync Data" can push / pull
//       { "name": "Shield (home)", "hostId": "shield",
//         "base": "http://192.168.4.167:8080" }
//     ],
//     "archiveDir": "archive/database",   // where pre-sync DB snapshots land
//     "keepBackups": 30                   // snapshots to keep per device
//   }
//
// A target whose hostId matches this device's hostId is the "source" — sync to
// it is disabled (the edits are already live here).
//
// The Sync panel can write config.json back through the file API, so targets
// and credentials can be managed on a tablet with no text editor. Hand-editing
// the file still works.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_URL = "config.json";

const DEFAULT_CONFIG = {
    hostId: "",
    syncTargets: [],
    archiveDir: "archive/database",
    keepBackups: 30,
};

// Populated by loadConfig(); read via getConfig(). Never reassigned — merged.
let CONFIG = { ...DEFAULT_CONFIG };

// Resolves once config.json has been fetched (or the default kept). app.js and
// sync.js await this before touching CONFIG.
const configReady = loadConfig();

async function loadConfig() {
    try {
        const res = await fetch(`${CONFIG_URL}?_=${Date.now()}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        CONFIG = normalizeConfig(raw);
    } catch (err) {
        console.warn(`[config.js] no usable ${CONFIG_URL} (${err.message}) — using defaults, Sync disabled.`);
        CONFIG = { ...DEFAULT_CONFIG };
    }
    return CONFIG;
}

function normalizeConfig(raw) {
    const c = { ...DEFAULT_CONFIG, ...(raw && typeof raw === "object" ? raw : {}) };
    c.hostId = String(c.hostId || "").trim();
    c.archiveDir = String(c.archiveDir || DEFAULT_CONFIG.archiveDir).replace(/^\/+|\/+$/g, "");
    c.keepBackups = Number.isFinite(+c.keepBackups) ? Math.max(0, Math.trunc(+c.keepBackups)) : 30;
    c.syncTargets = Array.isArray(c.syncTargets) ? c.syncTargets
        .filter(t => t && t.base)
        .map(t => ({
            name:   String(t.name || t.base).trim(),
            hostId: String(t.hostId || "").trim(),
            base:   String(t.base).trim().replace(/\/+$/, ""),
            user:   t.user ? String(t.user) : "",
            pass:   t.pass ? String(t.pass) : "",
        })) : [];
    return c;
}

function getConfig() { return CONFIG; }

// True when this device is the same host as `target` (so it IS the source).
function isSourceHost(target) {
    return !!(CONFIG.hostId && target && target.hostId && CONFIG.hostId === target.hostId);
}

// Persist the current CONFIG back to config.json via the file API. Best-effort:
// resolves false (never throws) so a read-only server doesn't break the panel.
async function saveConfig(next) {
    CONFIG = normalizeConfig(next || CONFIG);
    try {
        const body = JSON.stringify(CONFIG, null, 2) + "\n";
        const blob = new Blob([body], { type: "application/json" });
        const fd = new FormData();
        fd.append("files[]", blob, CONFIG_URL);
        const base = (typeof FILE_API_BASE === "string" && FILE_API_BASE) || "/api/file";
        const res = await fetch(`${base}/upload?path=`, { method: "PUT", body: fd });
        return res.ok;
    } catch (err) {
        console.warn(`[config.js] could not write ${CONFIG_URL}: ${err.message}`);
        return false;
    }
}
