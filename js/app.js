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

// Tabs that have an inline editor (see edit section below).
const EDITABLE_TABS = { purchase: renderPurchaseEditor };

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
            contentEl.innerHTML = renderKV(rows);
            break;
        }

        case "marketValue": {
            let html = tab.content ? `<p class="mv-summary">${tab.content}</p>` : "";
            ["GunBroker", "RockIsland"].forEach(source => {
                const s = tab[source];
                if (!s) return;
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

        case "rangeNotes": {
            const rows = [
                tab.Date     ? ["Date",     tab.Date]               : null,
                tab.Range    ? ["Range",    tab.Range]              : null,
                tab.Distance ? ["Distance", tab.Distance + " yd"]  : null,
                tab.Ammo     ? ["Ammo",     tab.Ammo]               : null,
                tab.Notes    ? ["Notes",    tab.Notes]              : null,
                tab.content  ? ["Summary",  tab.content]            : null,
            ].filter(Boolean);
            contentEl.innerHTML = renderKV(rows);
            break;
        }

        // history, loadData, maintenance — plain text
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
// ─────────────────────────────────────────────────────────────────────────────

// Swap a freshly reloaded firearm into both working lists after a save.
function replaceFirearm(fresh) {
    for (const list of [firearms, filteredFirearms]) {
        const i = list.findIndex(f => f.itemId === fresh.itemId);
        if (i !== -1) list[i] = fresh;
    }
}

// Purchase tab editor. Maps to the single `transactions` row where
// transaction_type = 'Purchase' (db.js savePurchase handles insert vs update).
function renderPurchaseEditor(firearm) {
    const contentEl = document.getElementById("scrollableTextContent");
    const p = (firearm.raw?.transactions || [])
        .find(t => t.transaction_type === "Purchase") || {};

    const fields = [
        { name: "date",     label: "Purchase date", type: "date" },
        { name: "price",    label: "Price",         type: "text", placeholder: "$0.00" },
        { name: "location", label: "Source",        type: "text", placeholder: "Seller / dealer / location" },
        { name: "url",      label: "Link",          type: "url",  placeholder: "https://…" },
        { name: "content",  label: "Listing",       type: "textarea", rows: 4 },
        { name: "notes",    label: "Notes",         type: "textarea", rows: 3 },
    ];

    const form = document.createElement("form");
    form.className = "edit-form";

    for (const f of fields) {
        const label = document.createElement("label");
        label.textContent = f.label;
        const input = document.createElement(f.type === "textarea" ? "textarea" : "input");
        if (f.type === "textarea") input.rows = f.rows;
        else input.type = f.type;
        if (f.placeholder) input.placeholder = f.placeholder;
        input.name = f.name;
        input.value = p[f.name] != null ? p[f.name] : "";
        label.appendChild(input);
        form.appendChild(label);
    }

    const actions = document.createElement("div");
    actions.className = "edit-actions";
    actions.innerHTML =
        `<button type="submit" class="edit-save">Save</button>` +
        `<button type="button" class="edit-cancel">Cancel</button>` +
        `<span class="edit-msg" role="status"></span>`;
    form.appendChild(actions);

    contentEl.innerHTML = "";
    contentEl.appendChild(form);

    const msg = actions.querySelector(".edit-msg");
    actions.querySelector(".edit-cancel").onclick =
        () => renderTabContent(firearm, "purchase");

    form.onsubmit = async (e) => {
        e.preventDefault();
        const saveBtn = actions.querySelector(".edit-save");
        saveBtn.disabled = true;
        msg.className = "edit-msg";
        msg.textContent = "Saving…";

        // Empty string -> null so blank fields clear the column.
        const values = {};
        for (const f of fields) {
            const v = form.elements[f.name].value.trim();
            values[f.name] = v === "" ? null : v;
        }

        try {
            await savePurchase(firearm, values);
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
