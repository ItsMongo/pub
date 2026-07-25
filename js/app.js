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
    const res = await fetch("data/firearms.json");
    const raw = await res.json();

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
   // document.getElementById("optic").textContent        = c.optic;
   // document.getElementById("sights").textContent       = c.sights;
   //document.getElementById("makerLogo").src = c.makerLogo ? `images/makers/${c.makerLogo}` : "";
   document.getElementById("makerLogo").src = `images/makers/${c.makerLogo}`;
   document.getElementById("makerLogo").alt = c.make;


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

function renderTabContent(firearm, tabKey) {
    const tab = firearm.tabs?.[tabKey];
    if (!tab) return;

    document.getElementById("scrollableTextTitle").textContent = tab.title || "";

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
                tab.content  ? ["Notes",   tab.content]  : null,
                tab.price    ? ["Price",   tab.price]    : null,
                tab.location ? ["Source",  tab.location] : null,
                tab.notes    ? ["Details", tab.notes]    : null,
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
// Image handling (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function loadImages(firearm) {
    const thumbnailStrip = document.getElementById("thumbnailStrip");
    const fullImage      = document.getElementById("fullImage");

    thumbnailStrip.innerHTML = "";

    const basePath = `../images/${firearm.imageID}/`;
    const response = await fetch(basePath + "images.json");
    const files    = await response.json();

    images = [];

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
