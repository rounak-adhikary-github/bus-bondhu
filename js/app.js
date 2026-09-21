/* ============================================================
   BusBondhu — application logic

   There are no departure times anywhere in this file. Neither published route
   list carries frequencies or timings, and no authoritative timetable exists
   for these 537 services, so the app answers "which buses run this stretch and
   how long is the ride" instead of pretending to know when the next one leaves.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- constants ---------------- */
  const KOLKATA_TZ = "Asia/Kolkata";

  /* category labels for the filters + row tags */
  const CAT_LABEL = { ac: "AC", electric: "Electric", nonac: "Non-AC" };
  const NEARBY_KM = 4;             // radius used for "try this stop instead" hints
  const TRANSFER_BUFFER = 5;       // minutes allowed to change buses at a hub
  /* No timetable exists for these services, so the app holds no departure
     times at all. See README: neither published route list carries frequencies
     or timings, so nothing here claims to know when the next bus leaves. */

  // Leaflet is vendored locally (vendor/leaflet/leaflet.js). This CDN copy is
  // only fetched on demand if the local file is missing, so the map still works
  // even if someone deploys without the vendor folder.
  const LEAFLET_CDN = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  const LEAFLET_TIMEOUT = 8000;

  /* Basemap providers, tried in order. All are key-free and permissive enough
     for a small public site: if one starts rate-limiting or goes away we fall
     through to the next. NOTE: CARTO basemaps used to be used here but now
     answer every keyless tile request with an "API KEY REQUIRED" watermark,
     which is what made the route map look like an empty box. */
  const TILE_PROVIDERS = [
    {
      id: "osm",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      options: {
        maxZoom: 19,
        crossOrigin: true,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      },
      dark: true
    },
    {
      id: "esri-dark-gray",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      options: {
        maxZoom: 16,
        attribution: "Tiles &copy; Esri"
      },
      dark: false
    }
  ];

  /* ---------------- element refs ---------------- */
  const $ = (id) => document.getElementById(id);

  const form        = $("searchForm");
  const srcInput    = $("source");
  const dstInput    = $("destination");
  const srcPanel    = $("sourceList");
  const dstPanel    = $("destinationList");
  const swapBtn     = $("swapBtn");
  const searchBtn   = $("searchBtn");
  const liveClock   = $("liveClock");
  const yearEl      = $("year");

  const resultsHead = $("resultsHead");
  const rhTitle     = $("rhTitle");
  const rhWindow    = $("rhWindow");
  const rhCount     = $("rhCount");
  const resultsList = $("resultsList");
  const resultsSec  = $("results");
  const emptyState  = $("emptyState");
  const filtersBox  = $("filters");

  const mapOverlay  = $("mapOverlay");
  const modalEl     = document.querySelector("#mapOverlay .modal");
  const modalClose  = $("modalClose");
  const mapEl       = $("map");
  const mapStatus   = $("mapStatus");
  const mapStatusMsg = $("mapStatusMsg");
  const mhBus       = $("mhBus");
  const mhRoute     = $("mhRoute");
  const mhSub       = $("mhSub");
  const mhKm        = $("mhKm");
  const mhMin       = $("mhMin");
  const mhStopsN    = $("mhStopsN");
  const mhStops     = $("mhStops");
  const mhStopCount = $("mhStopCount");

  const toast       = $("toast");
  const toastMsg    = $("toastMsg");

  /* ---------------- stop index ---------------- */
  /* Search is driven by BUS_STOPS (every stop WBTC lists), while the map only
     uses KOLKATA_STOPS (the stops we can actually place). Keeping these apart
     means a stop without coordinates is still findable, it just isn't plotted. */
  let STOP_LOOKUP = new Map();        // lowercase name -> canonical name
  let ROUTES_BY_STOP = new Map();     // stop -> [route index]
  let ROUTE_STOP_IDX = [];            // route index -> Map(stop -> position)
  let HUBS = [];                      // best interchange stops, busiest first
  const MAX_HUBS = 60;

  // Locality -> the stops inside it (from the dataset). Nobody asks for "SDF";
  // they ask for Sector V. A bus stopping anywhere in an area answers a search
  // for the area, while the map still plots the exact stop it uses.
  const AREAS = (typeof STOP_AREAS === "undefined") ? {} : STOP_AREAS;

  // Old spellings that the merge folded into another stop ("Sec V", "Bekbagan",
  // "Joka ESI Hospital"). They are no longer stops in their own right, so
  // without this a search for the name people have always used would come back
  // empty. Keys are lowercase, values are the surviving stop name.
  const ALIASES = (typeof STOP_ALIASES === "undefined") ? {} : STOP_ALIASES;

  function buildIndexes() {
    STOP_LOOKUP = new Map();
    BUS_STOPS.forEach((s) => STOP_LOOKUP.set(s.toLowerCase(), s));

    ROUTES_BY_STOP = new Map();
    ROUTE_STOP_IDX = BUS_ROUTES.map((route) => {
      const m = new Map();
      route.stops.forEach((s, i) => { if (!m.has(s)) m.set(s, i); });
      return m;
    });

    BUS_ROUTES.forEach((route, idx) => {
      // enumerable:false so it never leaks into the data or serialisation
      Object.defineProperty(route, "__idx", { value: idx, enumerable: false });
      new Set(route.stops).forEach((s) => {
        if (!ROUTES_BY_STOP.has(s)) ROUTES_BY_STOP.set(s, []);
        ROUTES_BY_STOP.get(s).push(idx);
      });
    });

    // Fold each area into the index. The area keeps its own name for search,
    // and points at the position of the member stop the route actually serves,
    // so segment maths, ride durations and the plotted line all stay exact.
    Object.keys(AREAS).forEach((area) => {
      const members = AREAS[area] || [];
      if (!STOP_LOOKUP.has(area.toLowerCase())) STOP_LOOKUP.set(area.toLowerCase(), area);

      // An area name is very often also a real stop — "Joka", "Thakurpukur",
      // "New Town" and "Salt Lake Sector V" all are. Resetting the list here
      // threw those routes away and the loop below skipped them as "already
      // covered", so searching "Joka" returned 2 of its 22 buses. Keep what is
      // already indexed and only add the routes that reach a different member.
      if (!ROUTES_BY_STOP.has(area)) ROUTES_BY_STOP.set(area, []);

      BUS_ROUTES.forEach((route, idx) => {
        const m = ROUTE_STOP_IDX[idx];
        if (!m) return;
        if (m.has(area)) return;                 // already listed under its own name
        for (let k = 0; k < members.length; k++) {
          const member = members[k];
          if (!m.has(member)) continue;
          m.set(area, m.get(member));
          ROUTES_BY_STOP.get(area).push(idx);
          return;
        }
      });
    });

    // Interchanges: the busiest stops make the only sensible changing points,
    // and capping the list keeps the dead-end search instant.
    HUBS = [...ROUTES_BY_STOP.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_HUBS)
      .map(([name]) => name);
  }

  /* ---------------- state ---------------- */
  let activeFilter   = "all";
  let map            = null;
  let mapLayer       = null;
  let tileLayer      = null;
  let providerIdx    = 0;
  let tileErrors     = 0;
  let mapIsLive      = false;  // at least one tile has painted
  let tilesGaveUp    = false;  // every provider failed
  let leafletFailed  = false;  // the map library itself never loaded
  let leafletPromise = null;
  let lastFocused    = null;

  const MSG_LOADING =
    '<span class="spinner"></span><b>Loading map\u2026</b>' +
    '<span>Fetching street tiles for this stretch.</span>';
  const MSG_TILES_FAILED =
    "<b>Map tiles aren't loading</b>" +
    "<span>This is usually a network or ad-blocker issue. Your route and stop list are still below.</span>";
  const MSG_LIB_FAILED =
    "<b>Map unavailable</b>" +
    "<span>The map library couldn't be loaded. Check your connection and reload the page \u2014 the stop list below still works.</span>";

  /* ============================================================
     DURATION HELPERS
     ============================================================ */

  /** minutes -> "1h 25m" / "45m" */
  function fmtDur(mins) {
    mins = Math.max(0, Math.round(mins));
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + "h " + m + "m";
    if (h) return h + "h";
    return m + "m";
  }

  /** live clock ticker — this is the current local time in Kolkata, not a bus time */
  function tickClock() {
    if (!liveClock) return;
    const t = new Intl.DateTimeFormat("en-GB", {
      timeZone: KOLKATA_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true
    }).format(new Date());
    liveClock.textContent = t.toUpperCase();
  }

  /* ============================================================
     SMALL UTILITIES
     ============================================================ */
  const escDiv = document.createElement("div");
  function esc(s) {
    escDiv.textContent = String(s);
    return escDiv.innerHTML;
  }

  /** great-circle distance in km between two [lat, lng] pairs */
  function haversineKm(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const la1 = toRad(a[0]), la2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 +
              Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!toast || !toastMsg) return;
    toastMsg.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
  }

  /* ============================================================
     BUILD UI
     ============================================================ */

  /* ============================================================
     STOP PICKER
     ============================================================ */

  /**
   * The stop suggestions used to be a native <datalist>. That works on a
   * desktop browser and does nothing at all on a phone — iOS Safari and several
   * Android browsers either ignore it or open a sheet that cannot be filtered —
   * so the list is built in the DOM instead and behaves the same everywhere.
   *
   * Deliberate touch details:
   *   - rows are 46px tall, the smallest comfortable tap target
   *   - selection listens on `pointerdown`, because a tap outside the input
   *     blurs it first and the `click` would arrive after the list had closed
   *   - the list flips above the field when the keyboard leaves no room below
   *   - an empty field shows the busiest stops, so tapping it visibly does
   *     something instead of looking broken
   */

  const COMBO_LIMIT = 8;

  let COMBO_POOL = [];                 // [{ value, lower }] — every searchable name
  let POPULAR = [];                    // busiest stops, for an empty field
  const STOP_FREQ = new Map();

  function buildComboPool() {
    COMBO_POOL = BUS_STOPS.map((value) => ({ value, lower: value.toLowerCase() }));

    STOP_FREQ.clear();
    BUS_ROUTES.forEach((route) => {
      new Set(route.stops).forEach((s) => STOP_FREQ.set(s, (STOP_FREQ.get(s) || 0) + 1));
    });
    POPULAR = BUS_STOPS.slice()
      .sort((a, b) => (STOP_FREQ.get(b) || 0) - (STOP_FREQ.get(a) || 0) || a.localeCompare(b))
      .slice(0, COMBO_LIMIT);
  }

  /**
   * How well a name matches, or -1 for no match.
   * Someone typing "joka" wants Joka before "IIM Joka", so a prefix beats a
   * word-start, which beats a match buried in the middle.
   */
  function comboRank(lower, q) {
    if (lower === q) return 0;
    if (lower.startsWith(q)) return 1;
    const at = lower.indexOf(q);
    if (at < 0) return -1;
    return /[^a-z0-9]/.test(lower.charAt(at - 1) || "") ? 2 : 3;
  }

  /** ranked options for what has been typed (empty query -> popular stops) */
  function comboMatches(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return POPULAR.map((name) => ({ name, note: "" }));

    const hits = [];
    for (const item of COMBO_POOL) {
      const rank = comboRank(item.lower, q);
      if (rank < 0) continue;
      hits.push({ name: item.value, rank, len: item.lower.length });
    }
    hits.sort((a, b) => a.rank - b.rank || a.len - b.len || a.name.localeCompare(b.name));

    const out = hits.slice(0, COMBO_LIMIT).map((h) => ({ name: h.name, note: "" }));

    // A spelling that was merged away is no longer a stop, so it cannot match
    // the list — give it its own row rather than leaving the user stuck.
    const target = ALIASES[q] || ALIASES[q.replace(/[^a-z0-9]/g, "")];
    if (target && !out.some((o) => o.name === target)) {
      out.unshift({ name: target, note: "was \u201C" + query.trim() + "\u201D", alias: true });
    }
    return out;
  }

  function fillCombo(panel, query) {
    const items = comboMatches(query);
    panel.innerHTML = "";

    const head = document.createElement("div");
    head.className = "combo-head";
    if (!query.trim()) head.textContent = "Popular stops";
    else if (items.length) head.textContent = items.length + (items.length === 1 ? " match" : " matches");
    else head.textContent = "No matching stop";
    panel.appendChild(head);

    if (!items.length) {
      const none = document.createElement("div");
      none.className = "combo-empty";
      none.textContent =
        "Nothing matches \u201C" + query.trim() + "\u201D. Try a shorter spelling, " +
        "or pick the big stop nearest to it.";
      panel.appendChild(none);
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "combo-opt" + (item.alias ? " is-alias" : "");
      row.id = panel.id + "-opt-" + i;
      row.setAttribute("role", "option");
      row.dataset.value = item.name;

      const name = document.createElement("span");
      name.className = "co-name";
      name.textContent = item.name;
      row.appendChild(name);

      if (item.note) {
        const note = document.createElement("span");
        note.className = "co-note";
        note.textContent = item.note;
        row.appendChild(note);
      }
      frag.appendChild(row);
    });
    panel.appendChild(frag);
  }

  function setupCombo(input, panel) {
    const wrap = panel.parentElement;
    let active = -1;

    const rows = () => Array.prototype.slice.call(panel.querySelectorAll(".combo-opt"));

    function paintActive() {
      const list = rows();
      list.forEach((r, i) => r.classList.toggle("is-active", i === active));
      if (active >= 0 && list[active]) {
        input.setAttribute("aria-activedescendant", list[active].id);
        list[active].scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    /* The on-screen keyboard can leave no room below the field, so measure the
       visual viewport (which does shrink with the keyboard) and flip if needed. */
    function placePanel() {
      const vv = window.visualViewport;
      const viewTop = vv ? vv.offsetTop : 0;
      const viewH = vv ? vv.height : window.innerHeight;
      const box = wrap.getBoundingClientRect();
      const below = viewTop + viewH - box.bottom;
      const above = box.top - viewTop;
      panel.classList.toggle("flip", below < 300 && above > below);
    }

    function open() {
      fillCombo(panel, input.value);
      panel.hidden = false;
      wrap.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      active = -1;
      paintActive();
      placePanel();
    }

    function close() {
      panel.hidden = true;
      wrap.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function choose(row) {
      if (!row) return;
      input.value = row.dataset.value;
      close();
      // hand over to the other box if it is still empty — saves a tap on mobile
      const other = input === srcInput ? dstInput : srcInput;
      if (other && !other.value.trim()) other.focus();
    }

    input.addEventListener("input", open);
    input.addEventListener("focus", open);
    // tapping a field that is already focused fires no focus event, so Escape
    // (or a stray tap) would otherwise leave it with no way back to the list
    input.addEventListener("click", () => { if (panel.hidden) open(); });

    input.addEventListener("keydown", (e) => {
      if (panel.hidden) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
        return;
      }
      const list = rows();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        active = Math.min(active + 1, list.length - 1);
        paintActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        active = Math.max(active - 1, 0);
        paintActive();
      } else if (e.key === "Enter") {
        if (active >= 0) { e.preventDefault(); choose(list[active]); }
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    /* pointerdown, not click: on a phone the input blurs before a click lands,
       which would close the panel out from under the tap. The click handler is
       the fallback for a browser that blurs anyway or lacks Pointer Events —
       choosing twice with the same row is harmless, and doing nothing is not. */
    panel.addEventListener("pointerdown", (e) => {
      const row = e.target.closest(".combo-opt");
      if (!row) return;
      e.preventDefault();
      choose(row);
    });
    panel.addEventListener("click", (e) => {
      choose(e.target.closest(".combo-opt"));
    });

    // tapping anywhere else closes it (the delay lets pointerdown win first)
    input.addEventListener("blur", () => { setTimeout(close, 140); });

    /* Deliberately no close-on-scroll: the panel is absolutely positioned inside
       the field, so it travels with the input rather than detaching. Closing on
       scroll would break the phone case, where focusing a field makes the
       browser scroll it above the keyboard. */
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      const w = window.innerWidth;
      // a width change is a rotation; a height change is just the keyboard
      if (Math.abs(w - lastWidth) > 40) { lastWidth = w; close(); return; }
      if (!panel.hidden) placePanel();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (!panel.hidden) placePanel();
      });
    }
  }

  /* ============================================================
     ROUTE MATCHING
     ============================================================ */

  /** case-insensitive lookup of a stop name, following merged-away spellings */
  function canonicalStop(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    const hit = STOP_LOOKUP.get(key);
    if (hit) return hit;
    // aliases are keyed on the spelling as published; also try it with the
    // punctuation squeezed out so "Airport Gate No 1" meets "Airport Gate No. 1"
    return ALIASES[key] || ALIASES[key.replace(/[^a-z0-9]/g, "")] || null;
  }

  /**
   * Resolve what someone typed into a box.
   * `alias` is true when the name only matched because it is an old spelling
   * that was merged into another stop, so the UI can explain the substitution.
   */
  function resolveField(el) {
    const typed = String((el && el.value) || "").trim();
    const name = canonicalStop(typed);
    const key = typed.toLowerCase();
    return { name, typed, alias: !!name && !STOP_LOOKUP.has(key) };
  }

  /**
   * For a route, find the segment between source and destination.
   * Returns null if the route serves neither stop.
   *
   * Buses run a route in BOTH directions, so a route that lists Barasat last
   * still serves Esplanade -> Barasat and Barasat -> Esplanade. Without this,
   * a third of the network was unreachable: every terminus was a one-way door.
   */
  function segmentOf(route, from, to) {
    const idx = ROUTE_STOP_IDX[route.__idx];
    const i = idx ? idx.get(from) : route.stops.indexOf(from);
    const j = idx ? idx.get(to) : route.stops.indexOf(to);
    if (i === undefined || j === undefined || i === j) return null;

    const n = route.stops.length - 1;
    const reversed = i > j;

    return {
      fromIdx: i,
      toIdx: j,
      reversed: reversed,
      segDuration: route.duration * (Math.abs(j - i) / n),
      segKm: route.km * (Math.abs(j - i) / n)
    };
  }

  /** the stops of a segment, in the order you actually travel them */
  function segmentStops(route, seg) {
    const lo = Math.min(seg.fromIdx, seg.toIdx);
    const hi = Math.max(seg.fromIdx, seg.toIdx);
    const names = route.stops.slice(lo, hi + 1);
    return seg.reversed ? names.reverse() : names;
  }

  /**
   * Every bus that gets you from `from` to `to`, quickest ride first. Pure and
   * side-effect free: the real search and the "try this stop instead" hints both
   * use it, so a suggestion can never promise a trip the search then fails to
   * find.
   *
   * There is no time filter because there is no timetable: neither published
   * route list carries departure times, so the honest question this answers is
   * "which buses run this stretch", not "which one leaves next".
   */
  function computeRows(from, to) {
    const rows = [];
    // only routes that actually serve `from` can possibly serve both stops
    const ids = ROUTES_BY_STOP.get(from) || [];

    ids.forEach((id) => {
      const route = BUS_ROUTES[id];
      const seg = segmentOf(route, from, to);
      if (!seg) return;

      rows.push({ route, seg, stops: Math.abs(seg.toIdx - seg.fromIdx) + 1 });
    });

    rows.sort((a, b) =>
      a.seg.segDuration - b.seg.segDuration ||
      a.seg.segKm - b.seg.segKm ||
      a.stops - b.stops ||
      String(a.route.no).localeCompare(String(b.route.no), undefined, { numeric: true })
    );
    return rows;
  }

  /* ============================================================
     SEARCH
     ============================================================ */

  /**
   * @param {object} opts
   *   opts.silent  - don't toast validation errors (used for deep links)
   *   opts.scroll  - scroll results into view (true for user-initiated searches)
   *   opts.updateUrl - write ?from=&to= so the search is shareable
   */
  function runSearch(opts) {
    opts = opts || {};
    const f = resolveField(srcInput);
    const t = resolveField(dstInput);
    const from = f.name;
    const to = t.name;

    if (!from || !to) {
      if (!opts.silent) showToast("Please pick a valid source and destination from the list.");
      return false;
    }
    if (from === to) {
      if (!opts.silent) showToast("Source and destination can't be the same stop.");
      return false;
    }

    const rows = computeRows(from, to);

    activeFilter = "all";
    syncFilterButtons();

    renderResults(rows, from, to);
    if (opts.updateUrl) syncUrl(from, to);

    // An old spelling that had to be translated is worth saying out loud —
    // otherwise "Sec V" silently turning into "Salt Lake Sector V" looks like
    // the search ignored what was typed.
    if (!opts.silent) {
      const swapped = [];
      if (f.alias) swapped.push('"' + f.typed + '" is now ' + from);
      if (t.alias) swapped.push('"' + t.typed + '" is now ' + to);
      if (swapped.length) showToast(swapped.join("  \u00B7  "));
    }

    if (opts.scroll) scrollToResults();
    return true;
  }

  function scrollToResults() {
    const target = resultsHead.hidden ? emptyState : resultsHead;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderResults(rows, from, to) {
    resultsList.innerHTML = "";

    if (!rows.length) {
      resultsHead.hidden = true;
      emptyState.hidden = false;
      renderEmptyState(from, to);
      return;
    }

    emptyState.hidden = true;
    resultsHead.hidden = false;

    rhTitle.textContent = rows.length + (rows.length === 1 ? " bus" : " buses") +
                          " \u00B7 " + from + " \u2192 " + to;
    rhWindow.innerHTML =
      "Sorted by the shortest ride. " +
      "<span class=\"est-note\">Route numbers and stops come from WBTC's published " +
      "city-route list and Kolkata Bus-O-Pedia's catalogue. Neither list carries " +
      "departure times and no timetable is published for these services, so this " +
      "page shows <b>which buses run your stretch</b> and how long the ride takes " +
      "\u2014 not when the next one leaves. Ride times are estimates.</span>";

    const frag = document.createDocumentFragment();
    rows.forEach((r, idx) => {
      frag.appendChild(buildRow(r, idx));
    });
    resultsList.appendChild(frag);

    applyFilter(activeFilter);
  }

  /**
   * "Nothing found" state. Because the dataset is a sample, a dead-end search
   * is common, so instead of a shrug we point at the nearest stops that would
   * actually work.
   */
  function renderEmptyState(from, to) {
    emptyState.innerHTML =
      '<div class="es-ico">&#128533;</div>' +
      "<h3>No direct bus on this stretch</h3>" +
      "<p>We couldn't find a direct bus from <strong>" + esc(from) + "</strong> to <strong>" + esc(to) +
      "</strong>. Kolkata routes are heavily interlined, so a stop a few minutes away often does the job.</p>";

    // 1) a stop a short walk away is the nicest fix, so try that first
    const alts = findAlternatives(from, to);
    if (alts.length) {
      const wrap = document.createElement("div");
      wrap.className = "suggest";
      wrap.innerHTML = '<div class="suggest-head">Nearest stops that do connect</div>';

      const list = document.createElement("div");
      list.className = "suggest-list";

      alts.forEach((alt) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "suggest-chip";
        chip.innerHTML =
          '<span class="sc-ico">' + (alt.kind === "from" ? "\uD83D\uDCCD" : "\uD83C\uDFC1") + "</span>" +
          esc(alt.stop) + " <small>" + alt.km.toFixed(1) + " km</small>";
        chip.addEventListener("click", () => {
          if (alt.kind === "from") srcInput.value = alt.stop;
          else dstInput.value = alt.stop;
          runSearch({ updateUrl: true, scroll: true });
        });
        list.appendChild(chip);
      });

      wrap.appendChild(list);
      emptyState.appendChild(wrap);
      return;
    }

    // 2) Kolkata's long routes mostly funnel through a handful of hubs, so the
    //    honest answer for a cross-city pair is usually "change once".
    const plans = findTransferPlans(from, to);
    if (plans.length) {
      const wrap = document.createElement("div");
      wrap.className = "suggest";
      wrap.innerHTML = '<div class="suggest-head">Or change buses once along the way</div>';

      const list = document.createElement("div");
      list.className = "suggest-list plan-list";

      plans.forEach((p) => {
        const card = document.createElement("div");
        card.className = "suggest-plan";
        card.innerHTML =
          '<div class="plan-hub">\uD83D\uDD01\uFE0F Change at ' + esc(p.hub) + "</div>" +
          '<div class="plan-leg"><b>' + esc(p.legA.route.no) + "</b> " +
          esc(p.legA.route.stops[p.legA.seg.fromIdx]) + " \u2192 " + esc(p.hub) +
          " \u00B7 " + fmtDur(p.legA.seg.segDuration) + "</div>" +
          '<div class="plan-leg"><b>' + esc(p.legB.route.no) + "</b> " + esc(p.hub) +
          " \u2192 " + esc(p.legB.route.stops[p.legB.seg.toIdx]) +
          " \u00B7 " + fmtDur(p.legB.seg.segDuration) + "</div>" +
          '<div class="plan-total">door to door \u00B7 ' + fmtDur(p.total) + "</div>";
        list.appendChild(card);
      });

      wrap.appendChild(list);
      emptyState.appendChild(wrap);
      return;
    }

    emptyState.insertAdjacentHTML("beforeend",
      '<p class="suggest-none">Nothing connects these two stops, even with one change \u2014 try one of the quick picks, or a nearby stop.</p>');
  }

  /**
   * Nearest stops that make the trip work, changing only one end. Candidates
   * are run through the real search, so a chip we show is guaranteed to produce
   * buses when clicked.
   */
  function findAlternatives(from, to) {
    const fromC = KOLKATA_STOPS[from];
    const toC = KOLKATA_STOPS[to];
    const out = [];

    Object.keys(KOLKATA_STOPS).forEach((stop) => {
      if (stop === from || stop === to) return;

      const kmFrom = haversineKm(fromC, KOLKATA_STOPS[stop]);
      if (kmFrom <= NEARBY_KM && computeRows(stop, to).length) {
        out.push({ kind: "from", stop, km: kmFrom });
      }

      const kmTo = haversineKm(toC, KOLKATA_STOPS[stop]);
      if (kmTo <= NEARBY_KM && computeRows(from, stop).length) {
        out.push({ kind: "to", stop, km: kmTo });
      }
    });

    out.sort((a, b) => a.km - b.km);

    // keep at most 4, and at most 2 of each kind so both ends get attention
    const picked = [];
    let nFrom = 0, nTo = 0;
    out.forEach((a) => {
      if (picked.length >= 4) return;
      if (a.kind === "from" && nFrom >= 2) return;
      if (a.kind === "to" && nTo >= 2) return;
      if (a.kind === "from") nFrom++; else nTo++;
      picked.push(a);
    });
    return picked;
  }

  /**
   * One-change journeys. Most of Kolkata's long routes funnel through the same
   * few hubs, so for a cross-city pair the honest answer is usually "change
   * once" rather than "no bus". Both legs run through computeRows, so the buses
   * shown are exactly what the user gets if they search each leg themselves.
   */
  function findTransferPlans(from, to) {
    const plans = [];

    HUBS.forEach((hub) => {
      if (hub === from || hub === to) return;

      const legA = computeRows(from, hub)[0];
      if (!legA) return;
      const legB = computeRows(hub, to)[0];
      if (!legB) return;

      plans.push({
        hub, legA, legB,
        total: legA.seg.segDuration + TRANSFER_BUFFER + legB.seg.segDuration
      });
    });

    plans.sort((a, b) => a.total - b.total);
    return plans.slice(0, 2);
  }

  function buildRow(r, idx) {
    const route = r.route;
    const seg = r.seg;

    const el = document.createElement("article");
    el.className = "bus-row " + route.cat;
    el.style.animationDelay = Math.min(idx * 45, 400) + "ms";
    el.dataset.cat = route.cat;
    el.tabIndex = 0;
    el.setAttribute("role", "button");

    el.setAttribute(
      "aria-label",
      "Bus " + route.no + " by " + route.operator + ", " + route.stops[seg.fromIdx] +
      " to " + route.stops[seg.toIdx] + ", about " + fmtDur(seg.segDuration) +
      " for " + seg.segKm.toFixed(1) + " km over " + r.stops + " stops. Open route map."
    );

    /* --- bus number badge --- */
    const badge = document.createElement("div");
    badge.className = "bus-no" + (route.no.length > 6 ? " long" : "");
    badge.innerHTML = esc(route.no) + "<small>" + esc(route.operator) + "</small>";

    /* --- middle info --- */
    const info = document.createElement("div");
    info.className = "bus-info";

    const routeLine = document.createElement("div");
    routeLine.className = "bus-route";
    routeLine.innerHTML =
      esc(route.stops[seg.fromIdx]) +
      ' <span class="arrow">\u2192</span> ' +
      esc(route.stops[seg.toIdx]);
    info.appendChild(routeLine);

    const meta = document.createElement("div");
    meta.className = "bus-meta";

    meta.appendChild(tag(CAT_LABEL[route.cat] || "Bus", route.cat));
    meta.appendChild(tag(route.operator, "op"));
    meta.appendChild(tag(r.stops + (r.stops === 1 ? " stop" : " stops"), "via"));

    info.appendChild(meta);

    /* --- right side: how long the ride is, not when it leaves --- */
    const time = document.createElement("div");
    time.className = "bus-time";
    time.innerHTML =
      '<span class="ride">' + fmtDur(seg.segDuration) + "</span>" +
      '<span class="in"><b>' + seg.segKm.toFixed(1) + " km</b> ride</span>" +
      '<span class="go">View route map \u2192</span>';

    el.appendChild(badge);
    el.appendChild(info);
    el.appendChild(time);

    const open = () => openMap(r, el);
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    return el;
  }

  function tag(text, cls) {
    const s = document.createElement("span");
    s.className = "tag " + cls;
    s.textContent = text;
    return s;
  }

  /* ============================================================
     FILTERS
     ============================================================ */
  function applyFilter(f) {
    activeFilter = f;
    const rows = Array.prototype.slice.call(resultsList.querySelectorAll(".bus-row"));
    let visible = 0;

    rows.forEach((row) => {
      let show = true;
      if (f !== "all") show = row.dataset.cat === f;
      row.style.display = show ? "" : "none";
      if (show) visible++;
    });

    if (rhCount) {
      if (f === "all" || !rows.length) {
        rhCount.hidden = true;
        rhCount.textContent = "";
      } else {
        rhCount.hidden = false;
        rhCount.textContent = "Showing " + visible + " of " + rows.length +
                              " (" + (CAT_LABEL[f] || f) + " only)";
      }
    }

    if (visible === 0 && rows.length) {
      showToast("No buses match the \u201C" + (CAT_LABEL[f] || f) + "\u201D filter in this window.");
    }
  }

  function syncFilterButtons() {
    filtersBox.querySelectorAll(".filter").forEach((b) => {
      const on = b.dataset.filter === activeFilter;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ============================================================
     DEEP LINKS  (?from=..&to=..)
     ============================================================ */
  function syncUrl(from, to) {
    if (!window.history || !history.replaceState) return;
    try {
      const p = new URLSearchParams();
      p.set("from", from);
      p.set("to", to);
      history.replaceState(null, "", location.pathname + "?" + p.toString());
    } catch (err) {
      // file:// origins and sandboxed iframes can refuse this — harmless.
    }
  }

  function restoreFromUrl() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch (err) {
      return false;
    }
    const from = canonicalStop(params.get("from"));
    const to = canonicalStop(params.get("to"));
    if (!from || !to || from === to) return false;

    srcInput.value = from;
    dstInput.value = to;

    return runSearch({ silent: true, updateUrl: false, scroll: false });
  }

  /* ============================================================
     MAP MODAL
     ============================================================ */
  function setMapStatus(html) {
    if (!mapStatus) return;
    if (!html) {
      mapStatus.hidden = true;
      mapStatusMsg.innerHTML = "";
      return;
    }
    mapStatusMsg.innerHTML = html;
    mapStatus.hidden = false;
  }

  /**
   * Single source of truth for the overlay. Reopening the modal must NOT show
   * "Loading map..." forever: Leaflet fires tileload once per tile, so once the
   * map is live cached tiles never fire it again.
   */
  function refreshMapStatus() {
    if (leafletFailed) return setMapStatus(MSG_LIB_FAILED);
    if (tilesGaveUp) return setMapStatus(MSG_TILES_FAILED);
    if (!mapIsLive) return setMapStatus(MSG_LOADING);
    return setMapStatus(null);
  }

  function openMap(r, opener) {
    const route = r.route;
    const seg = r.seg;

    lastFocused = opener || document.activeElement;

    /* fill the modal BEFORE showing it, so it can never appear as an empty box */
    mhBus.textContent = route.no;
    mhRoute.textContent = route.stops[seg.fromIdx] + " \u2192 " + route.stops[seg.toIdx];
    mhSub.textContent = route.operator + " \u00B7 " + (CAT_LABEL[route.cat] || "Bus") +
                        " \u00B7 " + r.stops + " stops on your stretch";
    mhKm.textContent = seg.segKm.toFixed(1);
    mhMin.textContent = Math.round(seg.segDuration);
    mhStopsN.textContent = r.stops;

    // stop chain, in the order you ride them
    mhStops.innerHTML = "";
    const chain = segmentStops(route, seg);
    const mapped = chain.filter((n) => KOLKATA_STOPS[n]).length;
    mhStopCount.textContent = "(" + chain.length + " stops" +
      (mapped < chain.length ? " \u00B7 " + mapped + " mapped" : "") + ")";
    chain.forEach((name, i) => {
      const li = document.createElement("li");
      if (i === 0) li.className = "is-from";
      else if (i === chain.length - 1) li.className = "is-to";
      li.innerHTML = '<span class="dot"></span>' + esc(name);
      mhStops.appendChild(li);
    });

    mapOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    refreshMapStatus();

    // move focus into the dialog so keyboard + screen-reader users land here
    requestAnimationFrame(focusDialog);

    // Leaflet needs a visible container before sizing
    requestAnimationFrame(() => {
      drawMap(route, seg);
    });
  }

  /**
   * Put keyboard focus on the dialog's first control. Called again once the map
   * has finished initialising, because creating the Leaflet map can move focus
   * to the map container. Idempotent: does nothing if focus is already inside.
   */
  function focusDialog() {
    if (!modalClose || mapOverlay.hidden) return;
    if (modalEl && modalEl.contains(document.activeElement)) return;
    try { modalClose.focus({ preventScroll: true }); } catch (err) { /* older engines */ }
  }

  function closeMap() {
    mapOverlay.hidden = true;
    document.body.style.overflow = "";
    setMapStatus(null);
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  /* Keyboard trap: while the dialog is open, Tab cycles inside it. */
  function trapFocus(e) {
    if (e.key !== "Tab" || mapOverlay.hidden || !modalEl) return;

    const nodes = modalEl.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.prototype.filter.call(nodes, (n) => n.offsetParent !== null);
    if (!list.length) return;

    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && (active === first || !modalEl.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !modalEl.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function ensureLeaflet() {
    if (window.L && typeof window.L.map === "function") return Promise.resolve(true);
    if (leafletPromise) return leafletPromise;

    leafletPromise = new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };

      const s = document.createElement("script");
      s.src = LEAFLET_CDN;
      s.async = true;
      s.onload = () => done(!!(window.L && typeof window.L.map === "function"));
      s.onerror = () => done(false);
      document.head.appendChild(s);

      setTimeout(() => done(!!(window.L && typeof window.L.map === "function")), LEAFLET_TIMEOUT);
    });

    return leafletPromise;
  }

  /** attach (or swap to) a basemap provider */
  function attachTiles(idx) {
    const provider = TILE_PROVIDERS[idx];
    if (!provider) return;

    providerIdx = idx;
    tileErrors = 0;

    if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }

    tileLayer = L.tileLayer(provider.url, provider.options);

    tileLayer.on("tileload", () => {
      mapIsLive = true;
      tilesGaveUp = false;
      refreshMapStatus();
    });

    tileLayer.on("tileerror", () => {
      tileErrors++;
      // one bad tile happens (cancelled pans, offline blips); a run of them means
      // this provider is unusable, so move on rather than showing a blank map.
      if (tileErrors >= 4 && !mapIsLive && providerIdx < TILE_PROVIDERS.length - 1) {
        attachTiles(providerIdx + 1);
      } else if (tileErrors >= 6 && !mapIsLive) {
        tilesGaveUp = true;
        refreshMapStatus();
      }
    });

    tileLayer.addTo(map);
    mapEl.classList.toggle("dark-tiles", !!provider.dark);
  }

  function drawMap(route, seg) {
    ensureLeaflet().then((ok) => {
      if (!ok) {
        leafletFailed = true;
        refreshMapStatus();
        return;
      }

      if (!map) {
        map = L.map(mapEl, { zoomControl: true, attributionControl: true });
        mapIsLive = false;
        tilesGaveUp = false;
        attachTiles(0);
      }
      refreshMapStatus();

      if (mapLayer) { map.removeLayer(mapLayer); mapLayer = null; }

      const group = L.layerGroup();

      const pts = route.stops.map((s) => KOLKATA_STOPS[s]).filter(Boolean);

      // full route (dimmed)
      if (pts.length > 1) {
        L.polyline(pts, {
          color: "#8b5cf6", weight: 4, opacity: 0.35, dashArray: "6 8"
        }).addTo(group);
      }

      // highlighted segment (same order the bus actually travels)
      const segPts = segmentStops(route, seg)
        .map((s) => KOLKATA_STOPS[s]).filter(Boolean);

      if (segPts.length > 1) {
        L.polyline(segPts, {
          color: "#ffb703", weight: 6, opacity: 0.95, lineJoin: "round"
        }).addTo(group);
      }

      // markers — every stop on the route, hoverable points
      let seq = 0;
      route.stops.forEach((name, i) => {
        const c = KOLKATA_STOPS[name];
        if (!c) return;
        const isFrom = i === seg.fromIdx;
        const isTo = i === seg.toIdx;
        // between the two ends, whichever way the bus is travelling
        const inSeg = i >= Math.min(seg.fromIdx, seg.toIdx) && i <= Math.max(seg.fromIdx, seg.toIdx);

        const color = isFrom ? "#22c55e" : isTo ? "#22d3ee" : inSeg ? "#ffb703" : "#7c86ad";
        const radius = (isFrom || isTo) ? 10 : inSeg ? 7 : 4;

        let label;
        if (isFrom) label = "Board here \u00B7 " + name;
        else if (isTo) label = "Get off here \u00B7 " + name;
        else if (inSeg) { seq++; label = "Stop " + seq + " \u00B7 " + name; }
        else label = name;

        const marker = L.circleMarker(c, {
          radius: radius,
          color: color,
          weight: 2,
          fillColor: color,
          fillOpacity: (isFrom || isTo) ? 0.95 : inSeg ? 0.8 : 0.4
        });

        // hover tooltip — permanent for the boarding / alighting stops
        marker.bindTooltip(label, {
          permanent: (isFrom || isTo),
          direction: "top",
          offset: [0, -8],
          className: "stop-tip" + (isFrom ? " tip-from" : isTo ? " tip-to" : "")
        });

        marker.bindPopup(
          "<b>" + esc(name) + "</b>" +
          (isFrom ? "<br>\uD83D\uDCCD Board here" : "") +
          (isTo ? "<br>\uD83C\uDFC1 Get off here" : "") +
          (inSeg && !isFrom && !isTo ? "<br>Intermediate stop on this route" : "")
        );

        marker.addTo(group);
      });

      group.addTo(map);
      mapLayer = group;

      const bounds = segPts.length ? segPts : pts;
      if (bounds.length === 1) {
        map.setView(bounds[0], 14);
      } else if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
      }

      // the modal animates in, so re-measure once it has settled, then make
      // sure focus ended up inside the dialog rather than the map container
      setTimeout(() => {
        if (map) map.invalidateSize();
        focusDialog();
      }, 160);
    });
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (searchBtn.classList.contains("loading")) return;

    searchBtn.classList.add("loading");
    // #results is the aria-live region, so the busy flag belongs on it
    resultsSec.setAttribute("aria-busy", "true");

    // tiny delay so the loading state is perceivable
    setTimeout(() => {
      runSearch({ updateUrl: true, scroll: true });
      searchBtn.classList.remove("loading");
      resultsSec.removeAttribute("aria-busy");
    }, 240);
  });

  swapBtn.addEventListener("click", () => {
    const a = srcInput.value;
    srcInput.value = dstInput.value;
    dstInput.value = a;
    // if the user already has results, swapping should re-run rather than lie
    if (!resultsHead.hidden || !emptyState.hidden) {
      runSearch({ updateUrl: true, scroll: false });
    }
  });

  filtersBox.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter");
    if (!btn) return;
    applyFilter(btn.dataset.filter);
    syncFilterButtons();
  });

  document.querySelectorAll(".qp").forEach((b) => {
    b.addEventListener("click", () => {
      srcInput.value = b.dataset.from;
      dstInput.value = b.dataset.to;
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
  });

  modalClose.addEventListener("click", closeMap);
  mapOverlay.addEventListener("click", (e) => { if (e.target === mapOverlay) closeMap(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !mapOverlay.hidden) closeMap();
  });
  mapOverlay.addEventListener("keydown", trapFocus);

  window.addEventListener("popstate", () => {
    if (!restoreFromUrl()) {
      // URL cleared (or unusable) -> go back to the neutral empty state
      resultsList.innerHTML = "";
      resultsHead.hidden = true;
      emptyState.hidden = false;
    }
  });

  /* ============================================================
     INIT
     ============================================================ */
  function boot() {
    // The dataset must be present (js/data.js). Fail soft with a toast
    // instead of a blank, broken page if it ever isn't.
    if (typeof KOLKATA_STOPS === "undefined" || typeof BUS_ROUTES === "undefined" ||
        typeof BUS_STOPS === "undefined") {
      showToast("Schedule data failed to load. Please reload the page.");
      return;
    }

    buildIndexes();
    buildComboPool();
    setupCombo(srcInput, srcPanel);
    setupCombo(dstInput, dstPanel);
    syncFilterButtons();
    tickClock();
    setInterval(tickClock, 1000);
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());

    // A shared link like ?from=Esplanade&to=Barasat runs itself.
    restoreFromUrl();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
