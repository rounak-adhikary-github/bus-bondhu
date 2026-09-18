/* ============================================================
   BusBondhu — application logic
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- constants ---------------- */
  const KOLKATA_TZ = "Asia/Kolkata";
  const WINDOW_MIN = 120;          // search window: next 2 hours
  const FREQ_THRESHOLD = 20;       // headway <= this => show "every X min" badge

  /* category labels for the filters + row tags */
  const CAT_LABEL = { ac: "AC", electric: "Electric", nonac: "Non-AC" };
  const STEP = 15;                 // time dropdown interval
  const NEARBY_KM = 4;             // radius used for "try this stop instead" hints
  const TRANSFER_BUFFER = 5;       // minutes needed to change buses at a hub

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
  const hourSelect  = $("timeHour");
  const ampmSelect  = $("ampm");
  const stopList    = $("stopList");
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
  const mhArr       = $("mhArr");
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
    // so segment maths, timings and the plotted line all stay exact.
    Object.keys(AREAS).forEach((area) => {
      const members = AREAS[area] || [];
      if (!STOP_LOOKUP.has(area.toLowerCase())) STOP_LOOKUP.set(area.toLowerCase(), area);

      ROUTES_BY_STOP.set(area, []);
      BUS_ROUTES.forEach((route, idx) => {
        const m = ROUTE_STOP_IDX[idx];
        if (!m || m.has(area)) return;
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
    "<span>This is usually a network or ad-blocker issue. Your route, stops and timings are all listed below.</span>";
  const MSG_LIB_FAILED =
    "<b>Map unavailable</b>" +
    "<span>The map library couldn't be loaded. Check your connection and reload the page \u2014 the stop list below still works.</span>";

  /* ============================================================
     TIME HELPERS (all in Kolkata local time)
     ============================================================ */

  /** Current time in Kolkata as {h, m, minutes} */
  function kolkataNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: KOLKATA_TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    const h = parseInt(get("hour"), 10) % 24;
    const m = parseInt(get("minute"), 10);
    return { h, m, minutes: h * 60 + m };
  }

  /** minutes-from-midnight -> "8:15 AM"
   *  Segment travel times are fractional (a route's duration apportioned along
   *  its stops), so round first — otherwise ETAs render as "12:23.28571428571422 PM". */
  function fmtTime(mins) {
    mins = Math.round(mins);
    mins = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const mer = h >= 12 ? "PM" : "AM";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + String(m).padStart(2, "0") + " " + mer;
  }

  /** minutes -> "1h 25m" / "45m" */
  function fmtDur(mins) {
    mins = Math.max(0, Math.round(mins));
    const h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + "h " + m + "m";
    if (h) return h + "h";
    return m + "m";
  }

  /** live clock ticker */
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

  function buildTimeOptions() {
    const frag = document.createDocumentFragment();
    for (let mins = 0; mins < 1440; mins += STEP) {
      const opt = document.createElement("option");
      opt.value = String(mins);
      opt.textContent = fmtTime(mins);
      frag.appendChild(opt);
    }
    hourSelect.appendChild(frag);
  }

  function buildStopList() {
    const names = BUS_STOPS.slice().sort((a, b) => a.localeCompare(b));
    const frag = document.createDocumentFragment();
    names.forEach((n) => {
      const o = document.createElement("option");
      o.value = n;
      frag.appendChild(o);
    });
    stopList.appendChild(frag);
  }

  /* ============================================================
     RESOLVE SELECTED TIME
     ============================================================ */
  function resolveSelectedTime() {
    const now = kolkataNow();
    const rawHour = hourSelect.value;
    const mer = ampmSelect.value;

    // nothing chosen -> current Kolkata time
    if (rawHour === "" && mer === "") {
      return { minutes: now.minutes, auto: true };
    }

    let base;
    if (rawHour === "") {
      // only meridiem chosen -> apply to current hour
      base = now.minutes;
    } else {
      base = parseInt(rawHour, 10) || 0;
    }

    if (mer) {
      let h = Math.floor(base / 60);
      const m = base % 60;
      const isPM = h >= 12;
      if (mer === "PM" && !isPM) h += 12;
      if (mer === "AM" && isPM) h -= 12;
      base = h * 60 + m;
    }

    return { minutes: ((base % 1440) + 1440) % 1440, auto: false };
  }

  /* ============================================================
     ROUTE MATCHING
     ============================================================ */

  /** case-insensitive lookup of a stop name */
  function canonicalStop(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    return STOP_LOOKUP.get(key) || null;
  }

  /**
   * For a route, find the segment between source and destination.
   * Returns null if the route serves neither stop.
   *
   * Buses run a route in BOTH directions, so a route that lists Barasat last
   * still serves Esplanade -> Barasat and Barasat -> Esplanade. Without this,
   * a third of the network was unreachable: every terminus was a one-way door.
   * For the reverse trip the "already travelled" distance is measured from the
   * far terminus, since that is what the schedule's first/last departures mean.
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
      offsetFrom: reversed
        ? route.duration * ((n - i) / n)     // mins from the far terminus to the source
        : route.duration * (i / n),
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
   * All departures of a route from the source stop inside the window.
   * Returns array of minutes-from-midnight.
   */
  function departuresInWindow(route, seg, startMin, endMin) {
    const out = [];
    const hw = route.headway;
    if (!(hw > 0)) return out;               // guard against bad data

    const firstDep = route.first + seg.offsetFrom;
    const lastDep = route.last + seg.offsetFrom;

    // first departure at/after startMin
    let k = Math.ceil((startMin - firstDep) / hw);
    if (k < 0) k = 0;

    for (let t = firstDep + k * hw; t <= endMin && t <= lastDep; t += hw) {
      if (t >= startMin) out.push(t);
    }
    return out;
  }

  /**
   * Every bus that gets you from `from` to `to` with a departure inside
   * [startMin, endMin], soonest first. Pure and side-effect free: the real
   * search and the "try this stop instead" hints both use it, so a suggestion
   * can never promise a trip the search then fails to find.
   */
  function computeRows(from, to, startMin, endMin) {
    const rows = [];
    // only routes that actually serve `from` can possibly serve both stops
    const ids = ROUTES_BY_STOP.get(from) || [];

    ids.forEach((id) => {
      const route = BUS_ROUTES[id];
      const seg = segmentOf(route, from, to);
      if (!seg) return;

      const deps = departuresInWindow(route, seg, startMin, endMin);
      if (!deps.length) return;

      rows.push({
        route,
        seg,
        departures: deps,
        next: deps[0],
        last: deps[deps.length - 1],
        count: deps.length
      });
    });

    rows.sort((a, b) => a.next - b.next);
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
    const from = canonicalStop(srcInput.value);
    const to = canonicalStop(dstInput.value);

    if (!from || !to) {
      if (!opts.silent) showToast("Please pick a valid source and destination from the list.");
      return false;
    }
    if (from === to) {
      if (!opts.silent) showToast("Source and destination can't be the same stop.");
      return false;
    }

    const sel = resolveSelectedTime();
    const startMin = sel.minutes;
    const endMin = startMin + WINDOW_MIN;

    const rows = computeRows(from, to, startMin, endMin);

    activeFilter = "all";
    syncFilterButtons();

    renderResults(rows, from, to, startMin, endMin, sel.auto);
    if (opts.updateUrl) syncUrl(from, to, sel);
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
  function renderResults(rows, from, to, startMin, endMin, auto) {
    resultsList.innerHTML = "";

    if (!rows.length) {
      resultsHead.hidden = true;
      emptyState.hidden = false;
      renderEmptyState(from, to, startMin, endMin);
      return;
    }

    emptyState.hidden = true;
    resultsHead.hidden = false;

    rhTitle.textContent = rows.length + (rows.length === 1 ? " bus" : " buses") +
                          " \u00B7 " + from + " \u2192 " + to;
    rhWindow.innerHTML =
      "Departures between <b>" + fmtTime(startMin) + "</b> and <b>" + fmtTime(endMin) + "</b>" +
      (auto ? " \u00B7 <b>auto-detected</b> from Kolkata local time" : "") +
      " \u00B7 sorted by next bus" +
      "<br><span class=\"est-note\">Route numbers and stops come from WBTC's published " +
      "city-route list and Kolkata Bus-O-Pedia's catalogue. Frequencies and times are " +
      "<b>estimates</b>, not official timings.</span>";

    const frag = document.createDocumentFragment();
    rows.forEach((r, idx) => {
      frag.appendChild(buildRow(r, idx, startMin));
    });
    resultsList.appendChild(frag);

    applyFilter(activeFilter);
  }

  /**
   * "Nothing found" state. Because the dataset is a sample, a dead-end search
   * is common, so instead of a shrug we point at the nearest stops that would
   * actually work.
   */
  function renderEmptyState(from, to, startMin, endMin) {
    emptyState.innerHTML =
      '<div class="es-ico">&#128533;</div>' +
      "<h3>No direct bus on this stretch</h3>" +
      "<p>We couldn't find a direct bus from <strong>" + esc(from) + "</strong> to <strong>" + esc(to) +
      "</strong> between <strong>" + fmtTime(startMin) + "</strong> and <strong>" + fmtTime(endMin) +
      "</strong>. Kolkata routes are heavily interlined, so a stop a few minutes away often does the job.</p>";

    // 1) a stop a short walk away is the nicest fix, so try that first
    const alts = findAlternatives(from, to, startMin, endMin);
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
    const plans = findTransferPlans(from, to, startMin, endMin);
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
          '<div class="plan-leg"><b>' + esc(p.legA.route.no) + "</b> " + fmtTime(p.legA.next) +
          " \u2192 " + fmtTime(p.arrive) + "</div>" +
          '<div class="plan-leg"><b>' + esc(p.legB.route.no) + "</b> " + fmtTime(p.legB.next) +
          " \u2192 " + fmtTime(p.arriveFinal) + "</div>" +
          '<div class="plan-total">door to door \u00B7 ' + fmtDur(p.total) + "</div>";
        list.appendChild(card);
      });

      wrap.appendChild(list);
      emptyState.appendChild(wrap);
      return;
    }

    emptyState.insertAdjacentHTML("beforeend",
      '<p class="suggest-none">Nothing connects these two stops in the next 2 hours, even with one change \u2014 try a different time of day, or one of the quick picks.</p>');
  }

  /**
   * Nearest stops that make the trip work, changing only one end. Candidates
   * are run through the real search for the same time window, so a chip we show
   * is guaranteed to produce buses when clicked.
   */
  function findAlternatives(from, to, startMin, endMin) {
    const fromC = KOLKATA_STOPS[from];
    const toC = KOLKATA_STOPS[to];
    const out = [];

    Object.keys(KOLKATA_STOPS).forEach((stop) => {
      if (stop === from || stop === to) return;

      const kmFrom = haversineKm(fromC, KOLKATA_STOPS[stop]);
      if (kmFrom <= NEARBY_KM && computeRows(stop, to, startMin, endMin).length) {
        out.push({ kind: "from", stop, km: kmFrom });
      }

      const kmTo = haversineKm(toC, KOLKATA_STOPS[stop]);
      if (kmTo <= NEARBY_KM && computeRows(from, stop, startMin, endMin).length) {
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
   * once" rather than "no bus". Both legs run through computeRows, so the times
   * shown are exactly what the user gets if they search each leg themselves.
   */
  function findTransferPlans(from, to, startMin, endMin) {
    const plans = [];

    HUBS.forEach((hub) => {
      if (hub === from || hub === to) return;

      const legA = computeRows(from, hub, startMin, endMin)[0];
      if (!legA) return;

      const arrive = legA.next + legA.seg.segDuration;
      const catchFrom = arrive + TRANSFER_BUFFER;
      const legB = computeRows(hub, to, catchFrom, catchFrom + WINDOW_MIN)[0];
      if (!legB) return;

      const arriveFinal = legB.next + legB.seg.segDuration;
      plans.push({ hub, legA, legB, arrive, arriveFinal, total: arriveFinal - legA.next });
    });

    plans.sort((a, b) => a.total - b.total);
    return plans.slice(0, 2);
  }

  function buildRow(r, idx, startMin) {
    const route = r.route;
    const seg = r.seg;

    const el = document.createElement("article");
    el.className = "bus-row " + route.cat;
    el.style.animationDelay = Math.min(idx * 45, 400) + "ms";
    el.dataset.cat = route.cat;
    el.tabIndex = 0;
    el.setAttribute("role", "button");

    const waitMin = r.next - startMin;
    const arriveMin = r.next + seg.segDuration;

    el.setAttribute(
      "aria-label",
      "Bus " + route.no + " by " + route.operator + ", " + route.stops[seg.fromIdx] +
      " to " + route.stops[seg.toIdx] + ", next bus at " + fmtTime(r.next) +
      ", " + fmtDur(seg.segDuration) + " ride. Open route map."
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
    meta.appendChild(tag(seg.segKm.toFixed(1) + " km", "via"));
    meta.appendChild(tag(fmtDur(seg.segDuration) + " ride", "via"));

    // frequency highlight (requirement 7)
    if (route.headway <= FREQ_THRESHOLD) {
      const fb = document.createElement("span");
      fb.className = "freq-badge";
      fb.innerHTML = '<span class="bolt">\u26A1</span> Every ' + route.headway + " min";
      fb.title = "This bus runs every " + route.headway + " minutes \u2014 " + r.count +
                 " departures in your 2-hour window, shown once.";
      meta.appendChild(fb);
    } else if (r.count > 1) {
      meta.appendChild(tag(r.count + " trips in window", "via"));
    }

    info.appendChild(meta);

    /* --- right timing --- */
    const time = document.createElement("div");
    time.className = "bus-time";
    time.innerHTML =
      '<span class="next">' + fmtTime(r.next) + "</span>" +
      '<span class="in">' + (waitMin <= 0 ? "leaving now" : "in <b>" + fmtDur(waitMin) + "</b>") + "</span>" +
      '<span class="eta">reaches ~' + fmtTime(arriveMin) + "</span>" +
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
     DEEP LINKS  (?from=..&to=..&at=<minutes>)
     ============================================================ */
  function syncUrl(from, to, sel) {
    if (!window.history || !history.replaceState) return;
    try {
      const p = new URLSearchParams();
      p.set("from", from);
      p.set("to", to);
      if (!sel.auto) p.set("at", String(sel.minutes));
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

    const at = parseInt(params.get("at"), 10);
    if (!isNaN(at) && at >= 0) {
      const snapped = Math.min(1425, Math.max(0, Math.round(at / STEP) * STEP));
      hourSelect.value = String(snapped);
      ampmSelect.value = "";
    }

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
                        " \u00B7 every ~" + route.headway + " min (estimated)";
    mhKm.textContent = seg.segKm.toFixed(1);
    mhMin.textContent = Math.round(seg.segDuration);
    mhArr.textContent = fmtTime(r.next);

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
    buildTimeOptions();
    buildStopList();
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
