// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/shttps-client.js — reusable client for the SHTTPS+ database REST
// API. Handles auth against both Basic and session/web login modes.
//
//   const { create, argsFromProcess } = require("./lib/shttps-client");
//   const a = argsFromProcess();
//   const client = create(a);
//   const { columns, data } = await client.runSql("SELECT * FROM items LIMIT 5");
//   await client.insert("load_data", [{ item_id: "LE41", powder: "Varget" }]);
//   await client.update("items", { note: "x" }, filters({ item_id: "LE41" }));
//   await client.del("load_data", filters({ item_id: "LE41" }));
// ─────────────────────────────────────────────────────────────────────────────

// SHTTPS+'s login form hashes the password with this exact function (FNV-1a,
// 32-bit) before POSTing it — see shttps-static-public/auth/login.js.
function fnv1aHex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
}

// { col: value } -> SHTTPS filter object with "=" operators.
function filters(equals) {
    const clauses = [], args = [];
    for (const [col, val] of Object.entries(equals)) { clauses.push(col + "="); args.push(val); }
    return { clauses, args };
}

// Pull base URL / credentials / flags from argv + env. First non-flag arg is the
// URL; --user=/--pass= or SHTTPS_URL/SHTTPS_USER/SHTTPS_PASS also work.
function argsFromProcess(argv = process.argv) {
    const val = (name) => {
        const hit = argv.find(a => a.startsWith(`--${name}=`));
        return hit ? hit.slice(name.length + 3) : undefined;
    };
    const urlArg = argv.slice(2).find(a => !a.startsWith("--"));   // explicit positional only
    return {
        urlArg,
        base:  urlArg || process.env.SHTTPS_URL || "",
        user:  val("user") || process.env.SHTTPS_USER,
        pass:  val("pass") || process.env.SHTTPS_PASS || "",
        flags: new Set(argv.slice(2).filter(a => /^--[a-z-]+$/.test(a))),
        val,
    };
}

function create({ base, user, pass = "" }) {
    base = (base || "").replace(/\/$/, "");
    let cookie = null;

    async function sessionLogin() {
        const body = new URLSearchParams({ username: user, password: fnv1aHex(pass) }).toString();
        const res = await fetch(`${base}/api/user/login`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        if (res.status === 404) return false;              // route absent -> not session mode
        if (!res.ok) throw new Error(`Session login failed (HTTP ${res.status}) — check --user / --pass.`);
        const raw = (res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""]).join("; ");
        const m = raw.match(/SESSION_ID=([^;]+)/);
        if (!m) throw new Error("Login succeeded but no SESSION_ID cookie came back.");
        cookie = `SESSION_ID=${m[1]}`;
        return true;
    }

    async function req(pathAndQuery, { method, contentType, body }) {
        const build = () => {
            const headers = { "Content-Type": contentType };
            if (cookie) headers.Cookie = cookie;
            else if (user) headers.Authorization =
                "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
            return fetch(`${base}${pathAndQuery}`, { method, headers, body });
        };

        let res = await build();
        if (res.status === 401 && !cookie && user &&
            !(res.headers.get("www-authenticate") || "").toLowerCase().includes("basic")) {
            if (await sessionLogin()) res = await build();
        }

        const text = await res.text();
        if (!res.ok) {
            if (res.status === 401) throw new Error(user
                ? "HTTP 401 — credentials rejected. Check --user / --pass."
                : "HTTP 401 — server needs auth. Re-run with  --user=NAME --pass=SECRET");
            if (res.status === 403) throw new Error(
                'HTTP 403 — authenticated but not allowed. Turn on "Enable API to call custom SQL" ' +
                'and "Enable API to modify tables data" in SHTTPS+, and grant this user the rights.');
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
        }
        return text;
    }

    const form = (obj) => new URLSearchParams(obj).toString();

    return {
        base,
        // Run arbitrary SQL. Returns { columns, data } for SELECT/PRAGMA, else {}.
        async runSql(sql, { limit = 1000, offset = 0 } = {}) {
            const text = await req(
                `/api/db/query?includeNames=true&limit=${limit}&offset=${offset}`,
                { method: "POST", contentType: "text/plain", body: sql });
            try { return JSON.parse(text); } catch { return {}; }
        },
        // rows: one object or an array of objects
        insert: (table, rows) => req("/api/db/insert", {
            method: "POST", contentType: "application/x-www-form-urlencoded",
            body: form({ table, values: JSON.stringify(rows) }),
        }),
        update: (table, values, filt) => req("/api/db/update", {
            method: "PUT", contentType: "application/x-www-form-urlencoded",
            body: form({ table, values: JSON.stringify(values), filters: JSON.stringify(filt) }),
        }),
        del: (table, filt) => req("/api/db/delete", {
            method: "DELETE", contentType: "application/x-www-form-urlencoded",
            body: form({ table, filters: JSON.stringify(filt) }),
        }),
    };
}

module.exports = { create, filters, fnv1aHex, argsFromProcess };
