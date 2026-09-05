// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let firearms         = [];   // master list — sorted, never mutated
let filteredFirearms = [];   // current working set (subset by activeType)
let currentIndex     = 0;   // index into filteredFirearms
let images           = [];
let thumbIndex       = 0;
let activeType       = "";   // "" = All
let currentTab       = "history";

// ─────────────────────────────────────────────────────────────────────────────
// Viewer (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
const viewer = new Viewer(document.getElementById('fullImageContainer'), {
    navbar: false,
    title: false,
    rotatable: true,
    toolbar: {
        zoomIn: true,
        zoomOut: true,
        oneToOne: true,
        reset: true,
        rotateLeft: true,
        rotateRight: true,
        prev: { show: true, size: 'large', click: () => prevImage() },
        next: { show: true, size: 'large', click: () => nextImage() }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function loadData() {
    // Pulls from the SQLite database via SHTTPS+'s /api/db REST API (see js/db.js),
    // falling back to data/firearms.json if the API can't be reached.
    const raw = await loadCollection();

    // Sort master list alphabetically by make, then model
    firearms = raw.slice().sort((a, b) => {
        const makeCompare = a.make.localeCompare(b.make);
        return makeCompare !== 0 ? makeCompare : a.model.localeCompare(b.model);
    });

    filteredFirearms = firearms.slice(); // start with All

    initTypeSelector();
    rebuildModelSelector();
    updateUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// Type toggle filter
// ─────────────────────────────────────────────────────────────────────────────
function initTypeSelector() {
    const group      = document.getElementById("typeToggleGroup");
    const typeSelect = document.getElementById("typeSelector"); // hidden, kept for compat

    // Unique types from master list, preserving sorted order
    const types = [...new Set(firearms.map(c => c.type))].sort();

    // Populate hidden select (for any external JS that may read it)
    typeSelect.innerHTML = "";
    [{ value: "", label: "All" }, ...types.map(t => ({ value: t, label: t }))]
        .forEach(({ value, label }) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            typeSelect.appendChild(opt);
        });

    // Build visible toggle buttons — "All" first, then each type
    group.innerHTML = "";
    const allTypes = ["", ...types];
    allTypes.forEach(t => {
        const btn = document.createElement("button");
        btn.className   = "type-toggle" + (t === activeType ? " active" : "");
        btn.dataset.type = t;
        btn.textContent  = t || "All";
        btn.title        = t || "Show all types";
        group.appendChild(btn);
    });

    // Click handler
    group.addEventListener("click", e => {
        const btn = e.target.closest(".type-toggle");
        if (!btn) return;

        activeType = btn.dataset.type;

        // Update toggle active state
        group.querySelectorAll(".type-toggle")
             .forEach(b => b.classList.toggle("active", b.dataset.type === activeType));

        // Sync hidden select
        typeSelect.value = activeType;

        // Rebuild filtered list and dropdown, reset to first item
        filteredFirearms = activeType
            ? firearms.filter(c => c.type === activeType)
            : firearms.slice();

        currentIndex = 0;
        rebuildModelSelector();
        updateUI();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Model (Jump-To) dropdown — always reflects filteredFirearms
// ─────────────────────────────────────────────────────────────────────────────
function rebuildModelSelector() {
    const sel = document.getElementById("modelSelector");
    sel.innerHTML = "";

    filteredFirearms.forEach((c, idx) => {
        const opt = document.createElement("option");
        opt.value       = idx;
        opt.textContent = `${c.make}  ${c.model}`;
        sel.appendChild(opt);
    });

    sel.value = currentIndex;
}

// Wire modelSelector change once (delegated — safe to call multiple times via rebuildModelSelector)
document.getElementById("modelSelector").addEventListener("change", function () {
    currentIndex = parseInt(this.value);
    updateUI();
});

// ─────────────────────────────────────────────────────────────────────────────
// Prev / Next — navigate within filteredFirearms
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("prevBtn").onclick = () => {
    currentIndex = currentIndex > 0
        ? currentIndex - 1
        : filteredFirearms.length - 1;
    document.getElementById("modelSelector").value = currentIndex;
    updateUI();
};

document.getElementById("nextBtn").onclick = () => {
    currentIndex = currentIndex < filteredFirearms.length - 1
        ? currentIndex + 1
        : 0;
    document.getElementById("modelSelector").value = currentIndex;
    updateUI();
};

// ─────────────────────────────────────────────────────────────────────────────
// updateUI — drives all header fields from filteredFirearms[currentIndex]
// ─────────────────────────────────────────────────────────────────────────────
function updateUI() {
    const c = filteredFirearms[currentIndex];
    if (!c) return;

    document.getElementById("titleMake").textContent    = c.make;
    document.getElementById("titleModel").textContent   = c.model;
    document.getElementById("titleAction").textContent  = c.action;
    document.getElementById("titleYear").textContent    = c.year;
    document.getElementById("serialNum").textContent    = c.serialNumber;
    document.getElementById("caliber").textContent      = c.caliber;
    document.getElementById("weight").textContent       = c.weight;
    document.getElementById("feed").textContent         = c.feed;
    document.getElementById("magCapacity").textContent  = c.magCapacity;
    document.getElementById("cartridge").textContent    = c.cartridge;
    document.getElementById("COAL").textContent         = c.COAL;
    document.getElementById("country").textContent      = c.country;
    document.getElementById("flagImage").src            = c.flag;
    document.getElementById("cartridgeImage").src       = `images/cartridges/${c.cartridgeImage}`;
    document.getElementById("cartridgeLink").href       = c.cartridgeWiki;
    //document.getElementById("optic").textContent        = c.optic;
    //document.getElementById("sights").textContent       = c.sights;
    //document.getElementById("makerLogo").src = c.makerLogo ? `images/makers/${c.makerLogo}` : "";
    document.getElementById("makerLogo").src = `images/makers/${c.makerLogo}`;
    document.getElementById("makerLogo").alt = c.make;
    document.getElementById("makerLogoText").textContent = c.make;


    // Counter shows position within the filtered list
    document.getElementById("itemCounterTxt").textContent =
        `${currentIndex + 1} of ${filteredFirearms.length}`;

    // Keep dropdown in sync
    document.getElementById("modelSelector").value = currentIndex;

    // Tab content + links
    loadTabs(c);

    thumbIndex = 0;
    loadImages(c);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab system
// ─────────────────────────────────────────────────────────────────────────────
function loadTabs(firearm) {
    document.querySelectorAll(".tab").forEach(btn => {
        btn.onclick = () => {
            currentTab = btn.dataset.tab;
            renderTabContent(firearm, currentTab);
        };
    });
    renderTabContent(firearm, currentTab);
}

// ── "list" tabs — a firearm has a running list of records (loads / range
// visits / services). All three share one read view and one editor, driven by
// TAB_LISTS below. `content` -> Notes, `source_url` -> Source link, `targets`
// -> handled separately; every other field maps 1:1 to a DB column.
const dot = "  ·  ";
const withUnit = (v, u) => (v ? v + " " + u : null);

const LOAD_FIELDS = [
    { name: "load_date",             label: "Date",              type: "date" },
    { name: "brass",                 label: "Brass",             type: "text" },
    { name: "primer",                label: "Primer",            type: "text" },
    { name: "powder",                label: "Powder",            type: "text" },
    { name: "charge_grains",         label: "Charge (gr)",       type: "text" },
    { name: "bullet_caliber",        label: "Bullet caliber",    type: "text" },
    { name: "bullet_type",           label: "Bullet type",       type: "text" },
    { name: "bullet_grains",         label: "Bullet wt (gr)",    type: "text" },
    { name: "ballistic_coefficient", label: "Ballistic coeff.",  type: "text" },
    { name: "sectional_density",     label: "Sectional density", type: "text" },
    { name: "velocity_fps",          label: "Velocity (fps)",    type: "text" },
    { name: "content",               label: "Notes",             type: "textarea", rows: 2 },
    { name: "source_url",            label: "Source",            type: "url" },
];

const RANGE_FIELDS = [
    { name: "date",           label: "Date",              type: "date" },
    { name: "batch_num",      label: "Batch #",           type: "text" },
    { name: "zero_yards",     label: "Zero (yd)",         type: "text" },
    { name: "sight_type",     label: "Sight type",        type: "select", options: ["Iron", "Optics", "Red dot"] },
    { name: "distance_yards", label: "Target dist (yd)",  type: "text" },
    { name: "shooting_pos",   label: "Shooting position", type: "select", options: ["Bench", "Kneeling", "Sitting", "Prone", "Off-Hand"] },
    { name: "accuracy_moa",   label: "Accuracy (MOA)",    type: "text" },
    { name: "notes",          label: "Notes",             type: "textarea", rows: 2 },
    { name: "targets",        label: "Targets",           type: "targets" },
];

const MAINT_FIELDS = [
    { name: "date",        label: "Date",         type: "date" },
    { name: "svc_type",    label: "Service type", type: "select", options: ["Deep-Clean", "Replace", "Fix", "Modify", "Add", "Restore"] },
    { name: "description", label: "Description",  type: "textarea", rows: 2 },
    { name: "maint_cost",  label: "Cost ($)",     type: "text" },
    { name: "notes",       label: "Notes",        type: "textarea", rows: 2 },
];

const TAB_LISTS = {
    loadData: {
        table: "load_data", pk: "load_id", singular: "Load", addLabel: "+ Add load", fields: LOAD_FIELDS,
        headline: (r, i) => [r.powder, withUnit(r.charge_grains, "gr"),
            withUnit(r.bullet_grains, "gr"), r.bullet_type].filter(Boolean).join(dot) || `Load ${i + 1}`,
    },
    rangeNotes: {
        table: "range_notes", pk: "range_id", singular: "Visit", addLabel: "+ Add visit", fields: RANGE_FIELDS,
        headline: (r, i) => [r.date, withUnit(r.distance_yards, "yd"),
            withUnit(r.accuracy_moa, "MOA")].filter(Boolean).join(dot) || `Visit ${i + 1}`,
    },
    maintenance: {
        table: "service_history", pk: "service_id", singular: "Service", addLabel: "+ Add service", fields: MAINT_FIELDS,
        headline: (r, i) => [r.date, r.svc_type].filter(Boolean).join(dot) || `Service ${i + 1}`,
    },
};

// Tabs whose title gets an "✎ Edit" button (single-form editors). The list tabs
// (loadData / rangeNotes / maintenance) render per-record Edit/Remove/Add
// controls in the summary view instead — see renderRecordSummary.
const EDITABLE_TABS = {
    purchase:    renderPurchaseEditor,
    marketValue: renderMarketValueEditor,
};

function renderTabContent(firearm, tabKey) {
    const tab = firearm.tabs?.[tabKey];
    if (!tab) return;

    document.getElementById("scrollableTextTitle").textContent = tab.title || "";

    // Show an "Edit" button next to the title for editable tabs, but only when
    // we're on the live database (the JSON fallback can't be written to).
    const titleWrap = document.querySelector(".scrollableTextTitle");
    titleWrap.querySelector(".tab-edit-btn")?.remove();
    if (EDITABLE_TABS[tabKey] && typeof isDbLive === "function" && isDbLive()) {
        const btn = document.createElement("button");
        btn.className = "tab-edit-btn";
        btn.type = "button";
        btn.textContent = "✎ Edit";
        btn.onclick = () => EDITABLE_TABS[tabKey](firearm);
        titleWrap.appendChild(btn);
    }

    // Wiki / GunDigest links — safe, shows "—" if url is blank
    const wikiUrl = tab.wikipedia?.url  || "";
    const gdUrl   = tab.gunDigest?.url  || "";
    document.getElementById("wikiLink").innerHTML =
        wikiUrl ? `<a href="${wikiUrl}" target="_blank">${firearm.model}</a>` : "—";
    document.getElementById("gunDigestLink").innerHTML =
        gdUrl   ? `<a href="${gdUrl}"   target="_blank">${firearm.model}</a>` : "—";

    const contentEl = document.getElementById("scrollableTextContent");

    switch (tabKey) {

        case "purchase": {
            const rows = [
                tab.date     ? ["Date",    tab.date]     : null,
                tab.price    ? ["Price",   tab.price]    : null,
                tab.location ? ["Source",  tab.location] : null,
                tab.url      ? ["Link",    `<a href="${tab.url}" target="_blank">${tab.url}</a>`] : null,
                tab.content  ? ["Listing", tab.content]  : null,
                tab.notes    ? ["Notes",   tab.notes]    : null,
            ].filter(Boolean);
            let html = renderKV(rows);
            const docs = parseDocs(tab.docs);
            if (docs.length) {
                html += `<div class="doc-read"><div class="doc-read-head">Documents</div>`
                    + docs.map(d => {
                        const src = `../images/${firearm.imageID}/docs/${d.filename}`;
                        const media = isImageName(d.filename)
                            ? `<img src="${src}" alt="">`
                            : `<span class="doc-file">${(d.filename.split(".").pop() || "doc").toUpperCase()}</span>`;
                        const tag = d.type ? `<span class="doc-tag">${d.type}</span>` : "";
                        return `<a href="${src}" target="_blank" class="doc-card">${media}`
                            + `<span class="doc-card-meta">${tag}<span class="doc-card-title">${d.title || d.filename}</span></span></a>`;
                    }).join("")
                    + `</div>`;
            }
            contentEl.innerHTML = html;
            break;
        }

        case "marketValue": {
            let html = tab.content ? `<p class="mv-summary">${tab.content}</p>` : "";
            ["GunBroker", "RockIsland"].forEach(source => {
                const s = tab[source];
                if (!s || (!s.avgValue && !s.url && !s.date)) return;
                const label = source === "RockIsland" ? "Rock Island Auction" : source;
                html += `<div class="mv-source">`;
                html += `<span class="mv-name">${label}</span>`;
                if (s.avgValue) html += `<span class="mv-value">${s.avgValue}</span>`;
                if (s.url)      html += ` <a href="${s.url}" target="_blank" class="mv-link">↗ Search</a>`;
                if (s.date)     html += `<div class="mv-date">${s.date}</div>`;
                html += `</div>`;
            });
            contentEl.innerHTML = html || "—";
            break;
        }

        case "loadData":
        case "rangeNotes":
        case "maintenance":
            renderRecordSummary(firearm, tabKey);
            break;

        // history — plain text
        default:
            contentEl.textContent = tab.content || "";
            break;
    }
}

// Shared key-value table renderer
function renderKV(rows) {
    if (!rows.length) return "—";
    return `<table class="kv-table">${
        rows.map(([k, v]) =>
            `<tr><td class="kv-label">${k}</td><td class="kv-value">${v}</td></tr>`
        ).join("")
    }</table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline editing
//
// Each editable tab has a render*Editor(firearm) function (see EDITABLE_TABS).
// It builds a form with buildEditForm(), then mountEditor() swaps it in for the
// read view and wires Save/Cancel. Save calls a per-tab save function in db.js,
// then reloads that firearm and re-renders. All DB knowledge lives in db.js.
// ─────────────────────────────────────────────────────────────────────────────

// Swap a freshly reloaded firearm into both working lists after a save.
function replaceFirearm(fresh) {
    for (const list of [firearms, filteredFirearms]) {
        const i = list.findIndex(f => f.itemId === fresh.itemId);
        if (i !== -1) list[i] = fresh;
    }
}

// Make an input / textarea / select element for a field spec, pre-filled.
function makeFieldEl(f, value) {
    let el;
    if (f.type === "select") {
        el = document.createElement("select");
        el.appendChild(new Option("—", ""));
        for (const o of f.options) el.appendChild(new Option(o, o));
    } else if (f.type === "textarea") {
        el = document.createElement("textarea");
        el.rows = f.rows || 3;
    } else {
        el = document.createElement("input");
        el.type = f.type || "text";
    }
    if (f.placeholder) el.placeholder = f.placeholder;
    el.value = value != null ? value : "";
    return el;
}

// Build a <form class="edit-form"> from a field spec. Entries are either
//   { heading: "text" }                                       — a section label
//   { name, label, type, rows?, placeholder?, options?, value } — a field
function buildEditForm(fields) {
    const form = document.createElement("form");
    form.className = "edit-form";

    for (const f of fields) {
        if (f.heading) {
            const h = document.createElement("div");
            h.className = "edit-group-heading";
            h.textContent = f.heading;
            form.appendChild(h);
            continue;
        }
        const label = document.createElement("label");
        label.textContent = f.label;
        if (f.type === "docs") {
            const w = buildDocWidget(f.value, f.imageID);
            w.el.__widget = w;
            label.appendChild(w.el);
        } else {
            const el = makeFieldEl(f, f.value);
            el.name = f.name;
            label.appendChild(el);
        }
        form.appendChild(label);
    }

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML =
        `<button type="submit" class="edit-save">Save</button>` +
        `<button type="button" class="edit-cancel">Cancel</button>` +
        `<span class="edit-msg" role="status"></span>`;
    form.appendChild(actions);
    return form;
}

// Swap `form` in for the read view and wire Save/Cancel. `onSave` gets a
// FormData and should throw on failure.
function mountEditor(firearm, tabKey, form, onSave) {
    const contentEl = document.getElementById("scrollableTextContent");
    contentEl.innerHTML = "";
    contentEl.appendChild(form);

    const actions = form.querySelector(".edit-actions");
    const msg     = actions.querySelector(".edit-msg");
    actions.querySelector(".edit-cancel").onclick =
        () => renderTabContent(firearm, tabKey);

    form.onsubmit = async (e) => {
        e.preventDefault();
        const saveBtn = actions.querySelector(".edit-save");
        saveBtn.disabled = true;
        msg.className = "edit-msg";
        msg.textContent = "Saving…";
        try {
            await onSave(new FormData(form));
            const fresh = await reloadFirearm(firearm.itemId);
            replaceFirearm(fresh);
            loadTabs(fresh); // re-render the tab from the refreshed record
        } catch (err) {
            msg.className = "edit-msg error";
            msg.textContent = "Save failed: " + err.message;
            saveBtn.disabled = false;
        }
    };
}

// Trim a FormData field; "" becomes null so a blank input clears the column.
const fdNull = (fd, key) => {
    const v = (fd.get(key) || "").trim();
    return v === "" ? null : v;
};

// Purchase tab → the single `transactions` row where transaction_type='Purchase'.
function renderPurchaseEditor(firearm) {
    const p = (firearm.raw?.transactions || [])
        .find(t => t.transaction_type === "Purchase") || {};

    const form = buildEditForm([
        { name: "date",     label: "Purchase date", type: "date",     value: p.date },
        { name: "price",    label: "Price",         type: "text",     value: p.price,    placeholder: "$0.00" },
        { name: "location", label: "Source",        type: "text",     value: p.location, placeholder: "Seller / dealer / location" },
        { name: "url",      label: "Link",          type: "url",      value: p.url,      placeholder: "https://…" },
        { name: "content",  label: "Listing",       type: "textarea", value: p.content, rows: 4 },
        { name: "notes",    label: "Notes",         type: "textarea", value: p.notes,   rows: 3 },
        { name: "docs",     label: "Documents",     type: "docs",     value: p.docs, imageID: firearm.imageID },
    ]);

    mountEditor(firearm, "purchase", form, async () => {
        const widget = form.querySelector(".doc-widget")?.__widget;
        let docsValue = null;
        if (widget) {
            const beforeFiles = parseDocs(p.docs).map(d => d.filename);
            let nextD = 0;
            for (const d of parseDocs(p.docs)) {
                const m = (d.filename || "").match(/-D(\d+)-/);
                if (m) nextD = Math.max(nextD, +m[1]);
            }
            const final = [];
            for (const entry of widget.state()) {
                let filename = entry.filename;
                if (!filename && entry.file) {
                    nextD += 1;
                    filename = docFilename(firearm.imageID, nextD, entry.file.name);
                    await uploadDoc(firearm.imageID, filename, entry.file);
                }
                if (filename) {
                    final.push({ filename, title: entry.title || null, type: entry.type || null });
                }
            }
            docsValue = final.length ? JSON.stringify(final) : null;
            const keptFiles = final.map(d => d.filename);
            await deleteDocs(firearm.imageID, beforeFiles.filter(f => !keptFiles.includes(f)));
        }

        const fd = new FormData(form);
        return savePurchase(firearm, {
            date:     fdNull(fd, "date"),
            price:    fdNull(fd, "price"),
            location: fdNull(fd, "location"),
            url:      fdNull(fd, "url"),
            content:  fdNull(fd, "content"),
            notes:    fdNull(fd, "notes"),
            docs:     docsValue,
        });
    });
}

// Market Value tab → the `transactions` rows where transaction_type='CurrentValue'
// (one per source: GunBroker, RockIsland). The Summary is shared across them.
function renderMarketValueEditor(firearm) {
    const cv = (firearm.raw?.transactions || [])
        .filter(t => t.transaction_type === "CurrentValue");
    const gb = cv.find(r => r.source === "GunBroker")  || {};
    const ri = cv.find(r => r.source === "RockIsland") || {};
    const summary = (cv.find(r => r.content) || {}).content || "";

    const form = buildEditForm([
        { name: "summary",  label: "Summary", type: "textarea", value: summary, rows: 4 },
        { heading: "GunBroker" },
        { name: "gb_value", label: "Value estimate", type: "text", value: gb.price, placeholder: "$300 – $500" },
        { name: "gb_url",   label: "Link",           type: "url",  value: gb.url,   placeholder: "https://…" },
        { name: "gb_note",  label: "Note",           type: "text", value: gb.notes },
        { heading: "Rock Island Auction" },
        { name: "ri_value", label: "Value estimate", type: "text", value: ri.price, placeholder: "$300 – $500" },
        { name: "ri_url",   label: "Link",           type: "url",  value: ri.url,   placeholder: "https://…" },
        { name: "ri_note",  label: "Note",           type: "text", value: ri.notes },
    ]);

    mountEditor(firearm, "marketValue", form, (fd) => saveMarketValue(firearm, fdNull(fd, "summary"), {
        GunBroker:  { value: fdNull(fd, "gb_value"), url: fdNull(fd, "gb_url"), note: fdNull(fd, "gb_note") },
        RockIsland: { value: fdNull(fd, "ri_value"), url: fdNull(fd, "ri_url"), note: fdNull(fd, "ri_note") },
    }));
}

// Summary (read) view for a list tab: every record with per-record Edit /
// Remove buttons, and an Add button at the bottom. Editing is one record at a
// time via renderRecordEditor.
function renderRecordSummary(firearm, tabKey) {
    const cfg = TAB_LISTS[tabKey];
    const tab = firearm.tabs[tabKey];
    const contentEl = document.getElementById("scrollableTextContent");
    const rows = tab.rows;
    const live = typeof isDbLive === "function" && isDbLive();

    if (!rows) { contentEl.textContent = tab.content || "—"; return; }  // JSON fallback

    contentEl.innerHTML = "";

    rows.forEach((row, i) => {
        const entry = document.createElement("div");
        entry.className = "load-entry";

        const head = document.createElement("div");
        head.className = "load-headline";
        const title = document.createElement("span");
        title.textContent = cfg.headline(row, i);
        head.appendChild(title);
        if (live) {
            const acts = document.createElement("span");
            acts.className = "entry-actions";
            const ed = document.createElement("button");
            ed.type = "button"; ed.className = "entry-edit"; ed.textContent = "Edit";
            ed.onclick = () => renderRecordEditor(firearm, tabKey, row);
            const rm = document.createElement("button");
            rm.type = "button"; rm.className = "entry-remove"; rm.textContent = "Remove";
            rm.onclick = () => removeRecord(firearm, tabKey, row);
            acts.append(ed, rm);
            head.appendChild(acts);
        }
        entry.appendChild(head);

        const kv = cfg.fields
            .filter(f => f.name !== "targets" && row[f.name])
            .map(f => [f.label, f.type === "url"
                ? `<a href="${row[f.name]}" target="_blank">${row[f.name]}</a>`
                : row[f.name]]);
        const kvWrap = document.createElement("div");
        kvWrap.innerHTML = renderKV(kv);
        entry.appendChild(kvWrap);

        const names = parseTargets(row.targets);
        if (names.length) {
            const grid = document.createElement("div");
            grid.className = "target-grid read";
            grid.innerHTML = names.map(n => {
                const src = `../images/${firearm.imageID}/targets/${n}`;
                return `<a href="${src}" target="_blank" class="target-thumb"><img src="${src}" alt="target"></a>`;
            }).join("");
            entry.appendChild(grid);
        }
        contentEl.appendChild(entry);
    });

    if (!rows.length) {
        const dash = document.createElement("div");
        dash.textContent = "—";
        contentEl.appendChild(dash);
    }

    if (live) {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "load-add";
        add.textContent = cfg.addLabel;
        add.onclick = () => renderRecordEditor(firearm, tabKey, null);   // null -> new record
        contentEl.appendChild(add);
    }
}

// Edit or add one record of a list tab. `row` is the DB row to edit, or null
// to add a new one. Save updates (by primary key) or inserts; Cancel returns
// to the summary.
function renderRecordEditor(firearm, tabKey, row) {
    const cfg    = TAB_LISTS[tabKey];
    const data   = row || {};
    const isNew  = !row;

    const form = document.createElement("form");
    form.className = "edit-form list-editor";

    const fs = document.createElement("fieldset");
    fs.className = "load-block";
    const legend = document.createElement("legend");
    legend.textContent = (isNew ? "New " : "") + cfg.singular;
    fs.appendChild(legend);

    for (const f of cfg.fields) {
        const label = document.createElement("label");
        label.textContent = f.label;
        if (f.type === "targets") {
            const widget = buildTargetWidget(data[f.name], firearm.imageID);
            widget.el.__widget = widget;
            label.appendChild(widget.el);
        } else {
            const el = makeFieldEl(f, data[f.name]);
            el.dataset.field = f.name;
            label.appendChild(el);
        }
        fs.appendChild(label);
    }
    form.appendChild(fs);

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML =
        `<button type="submit" class="edit-save">Save</button>` +
        `<button type="button" class="edit-cancel">Cancel</button>` +
        `<span class="edit-msg" role="status"></span>`;
    form.appendChild(actions);

    mountEditor(firearm, tabKey, form, async () => {
        const values = {};
        for (const el of fs.querySelectorAll("[data-field]")) {
            const v = el.value.trim();
            values[el.dataset.field] = v === "" ? null : v;
        }

        // Target images (range visits): upload the pending files, then delete
        // any this record used to reference but no longer does.
        const w = fs.querySelector(".target-widget")?.__widget;
        if (w) {
            const before = parseTargets(data.targets);
            let nextT = 0;
            for (const r of (firearm.raw?.[cfg.table] || [])) {
                for (const n of parseTargets(r.targets)) {
                    const m = n.match(/-T(\d+)-/);
                    if (m) nextT = Math.max(nextT, +m[1]);
                }
            }
            const names = w.kept();
            for (const file of w.pending()) {
                nextT += 1;
                const name = targetFilename(firearm.imageID, nextT, file.name);
                await uploadTarget(firearm.imageID, name, file);
                names.push(name);
            }
            values.targets = names.length ? JSON.stringify(names) : null;
            await deleteTargets(firearm.imageID, before.filter(n => !names.includes(n)));
        }

        if (isNew) {
            await dbInsert(cfg.table, { item_id: firearm.itemId, ...values });
        } else {
            await dbUpdate(cfg.table, values, dbFilters({ [cfg.pk]: row[cfg.pk] }));
        }
    });
}

// Delete one record of a list tab (and its target images), with a confirm.
async function removeRecord(firearm, tabKey, row) {
    const cfg = TAB_LISTS[tabKey];
    if (!window.confirm(`Remove this ${cfg.singular.toLowerCase()}?`)) return;
    try {
        const targets = parseTargets(row.targets);
        if (targets.length) await deleteTargets(firearm.imageID, targets);
        await dbDelete(cfg.table, dbFilters({ [cfg.pk]: row[cfg.pk] }));
        const fresh = await reloadFirearm(firearm.itemId);
        replaceFirearm(fresh);
        loadTabs(fresh);
    } catch (err) {
        window.alert("Remove failed: " + err.message);
    }
}

const parseTargets = (json) => {
    try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
};

// Build a target-image field: existing thumbnails (each removable) + a file
// picker for new ones. Uploads happen on Save (see renderRecordEditor).
function buildTargetWidget(targetsJson, imageID) {
    let kept = parseTargets(targetsJson);
    const pending = [];   // File objects not yet uploaded

    const el = document.createElement("div");
    el.className = "target-widget";
    const grid = document.createElement("div");
    grid.className = "target-grid";
    el.appendChild(grid);

    const thumb = (src, onRemove, isNew) => {
        const d = document.createElement("div");
        d.className = "target-thumb" + (isNew ? " target-new" : "");
        const img = document.createElement("img");
        img.src = src;
        d.appendChild(img);
        const x = document.createElement("button");
        x.type = "button";
        x.className = "target-x";
        x.textContent = "×";
        x.onclick = onRemove;
        d.appendChild(x);
        return d;
    };

    const render = () => {
        grid.innerHTML = "";
        kept.forEach(name => grid.appendChild(
            thumb(`../images/${imageID}/targets/${name}`, () => {
                kept = kept.filter(n => n !== name);
                render();
            })));
        pending.forEach(file => {
            const url = URL.createObjectURL(file);
            grid.appendChild(thumb(url, () => {
                pending.splice(pending.indexOf(file), 1);
                URL.revokeObjectURL(url);
                render();
            }, true));
        });
    };

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.className = "target-add";
    input.onchange = () => {
        for (const f of input.files) pending.push(f);
        input.value = "";
        render();
    };
    el.appendChild(input);
    render();

    return { el, kept: () => kept.slice(), pending: () => pending.slice() };
}

// images/<id>/<subdir>/<id>-<tag><n>-<sanitised-original>.<ext>
function uploadFilename(imageID, tag, n, original, allowedExts, fallbackExt) {
    const dotAt = original.lastIndexOf(".");
    let ext = (dotAt > -1 ? original.slice(dotAt + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!allowedExts.includes(ext)) ext = fallbackExt;
    const base = (dotAt > -1 ? original.slice(0, dotAt) : original)
        .replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "file";
    return `${imageID}-${tag}${n}-${base}.${ext}`;
}
const IMG_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
const targetFilename = (id, n, orig) => uploadFilename(id, "T", n, orig, IMG_EXTS, "jpg");
const docFilename    = (id, n, orig) => uploadFilename(id, "D", n, orig, [...IMG_EXTS, "pdf"], "pdf");
const isImageName    = (name) => IMG_EXTS.includes((name || "").split(".").pop().toLowerCase());

// ── purchase documents ──────────────────────────────────────────────────────
// transactions.docs (Purchase row) is JSON: [{filename, title, type}].

const DOC_TYPES = ["Bill of Sale", "Transfer", "Auction Listing", "Manual","Correspondence", "Certificate", "Bringback Doc"];

const parseDocs = (json) => {
    try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
};

// A documents field: rows of (preview) + Title + Type + remove, plus a file
// picker (images or PDFs). Uploads happen on Save (see renderPurchaseEditor).
function buildDocWidget(docsJson, imageID) {
    // entry: { filename?, file?, title, type }  (filename = existing, file = pending)
    const entries = parseDocs(docsJson).map(d => ({ ...d }));

    const el = document.createElement("div");
    el.className = "doc-widget";
    const list = document.createElement("div");
    list.className = "doc-list";
    el.appendChild(list);

    const render = () => {
        list.innerHTML = "";
        entries.forEach((entry, idx) => {
            const name = entry.filename || entry.file.name;
            const src  = entry.filename
                ? `../images/${imageID}/docs/${entry.filename}`
                : (entry.__url ||= URL.createObjectURL(entry.file));

            const row = document.createElement("div");
            row.className = "doc-row";

            const prev = document.createElement("a");
            prev.className = "doc-preview";
            prev.href = src;
            prev.target = "_blank";
            if (isImageName(name)) {
                const img = document.createElement("img");
                img.src = src;
                prev.appendChild(img);
            } else {
                prev.classList.add("doc-file");
                prev.textContent = (name.split(".").pop() || "doc").toUpperCase();
            }
            row.appendChild(prev);

            const title = document.createElement("input");
            title.type = "text";
            title.className = "doc-title";
            title.placeholder = "Title";
            title.value = entry.title || "";
            title.oninput = () => { entry.title = title.value; };
            row.appendChild(title);

            const type = document.createElement("select");
            type.className = "doc-type";
            type.appendChild(new Option("—", ""));
            for (const t of DOC_TYPES) type.appendChild(new Option(t, t));
            type.value = entry.type || "";
            type.onchange = () => { entry.type = type.value; };
            row.appendChild(type);

            const x = document.createElement("button");
            x.type = "button";
            x.className = "doc-x";
            x.textContent = "×";
            x.onclick = () => {
                if (entry.__url) URL.revokeObjectURL(entry.__url);
                entries.splice(idx, 1);
                render();
            };
            row.appendChild(x);
            list.appendChild(row);
        });
    };

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,application/pdf";
    input.multiple = true;
    input.className = "doc-add";
    input.onchange = () => {
        for (const f of input.files) {
            entries.push({ file: f, title: f.name.replace(/\.[^.]+$/, ""), type: "" });
        }
        input.value = "";
        render();
    };
    el.appendChild(input);
    render();

    return { el, state: () => entries };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image handling
// ─────────────────────────────────────────────────────────────────────────────
async function loadImages(firearm) {
    const thumbnailStrip = document.getElementById("thumbnailStrip");
    const fullImage      = document.getElementById("fullImage");

    thumbnailStrip.innerHTML = "";
    images = [];

    // Not every firearm has an image folder yet — treat a missing/!ok
    // images.json as "no images" rather than throwing.
    const basePath = `../images/${firearm.imageID}/`;
    let files = [];
    try {
        const response = await fetch(basePath + "images.json");
        if (response.ok) files = await response.json();
    } catch { /* no images for this item */ }

    if (!files.length) {
        fullImage.removeAttribute("src");
        return;
    }

    files.forEach((file, idx) => {
        const src = basePath + file;
        images.push(src);
        // preload
        const preload = new Image();
        preload.src = src;

        const img = document.createElement("img");
        img.src = src;
        img.onclick = () => {
            thumbIndex = idx;
            fullImage.src = images[thumbIndex];
            viewer.update();
            viewer.reset();
            highlightThumbnail();
        };
        thumbnailStrip.appendChild(img);
    });

    if (images.length > 0) {
        fullImage.src = images[thumbIndex];
        viewer.update();
        viewer.reset();
        highlightThumbnail();
    }
}

document.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp")   nextImage();
    if (e.key === "ArrowLeft"  || e.key === "ArrowDown") prevImage();
});

document.getElementById("thumbnailStrip").addEventListener("wheel", e => {
    e.preventDefault();
    document.getElementById("thumbnailStrip").scrollLeft += e.deltaY;
});

function nextImage() {
    thumbIndex = thumbIndex < images.length - 1 ? thumbIndex + 1 : 0;
    document.getElementById("fullImage").src = images[thumbIndex];
    viewer.update();
    highlightThumbnail();
}

function prevImage() {
    thumbIndex = thumbIndex > 0 ? thumbIndex - 1 : images.length - 1;
    document.getElementById("fullImage").src = images[thumbIndex];
    viewer.update();
    highlightThumbnail();
}

function highlightThumbnail() {
    const thumbs = document.getElementById("thumbnailStrip").querySelectorAll("img");
    thumbs.forEach(t => t.classList.remove("selected"));
    if (thumbs[thumbIndex]) {
        thumbs[thumbIndex].classList.add("selected");
        thumbs[thumbIndex].scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
loadData();
