/* ============================================================
   Stage 1b — kolbusopedia.com route lists -> structured routes.

   Input : tools/cache/kbo-private.html   (download with
             curl -sL https://www.kolbusopedia.com/bus-routes \
               -o tools/cache/kbo-private.html )
           tools/cache/kbo-govt.html
             curl -sL https://www.kolbusopedia.com/bus-routes-government \
               -o tools/cache/kbo-govt.html )
   Output: tools/cache/routes.extra.json  + a report on stdout

   WHY THIS SOURCE
     WBTC's official table only lists government routes (131 of them).
     The overwhelming majority of Kolkata's buses are privately operated
     and there is no official machine-readable list of them. Kolkata
     Bus-O-Pedia is the community-maintained catalogue that private
     operators, enthusiasts and the WBTC app's own route data agree
     with, and it publishes each route as

       "12C: Pailan to Howrah Station [via: Joka Bridge, Thakurpukur, ...]"

     so the number, the origin/destination pair and the stop sequence
     are all attributable to a published page.

   WHAT IS *NOT* IN THE SOURCE
     Frequencies and departure times (see stage 3 — they stay estimates).
   ============================================================ */
const fs = require("fs");

const SOURCES = [
  { file: "tools/cache/kbo-private.html", list: "private" },
  { file: "tools/cache/kbo-govt.html", list: "govt" },
];

const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "-",
  "&ndash;": "-",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
};

function stripTags(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => (ENTITIES[m.toLowerCase()] !== undefined ? ENTITIES[m.toLowerCase()] : " "))
    .replace(/[ \t\u00a0]+/g, " ");
}

/* ---------------------------------------------
   Pull route lines out of the page.

   Two layouts are used across the two pages, plus one arrow form:
     A  12C: Pailan to Howrah Station [via: A, B, C]
     A  32A: Dakshineshwar to Sector V (Saltlake) [via: ...]
     A  40B: Thakurpukur to Babughat [via: ...]
     B  VS1:- Airport Domestic Terminus to Esplanade L20 via Kaikhali, ...
     C  RT-35: Hantal -> Howrah Station [Baragachia, Domjur, ...]

   Everything before the first "via"/"[" is the origin -> destination
   pair, so the " to " search never runs over the stop list (which is
   full of places called "Lake Town" and "Tollygunge").
   --------------------------------------------- */
const HEAD_RE = /^([A-Za-z0-9][A-Za-z0-9./\-]*(?:\s*\([^)]*\))?(?:\s*[/+]\s*[A-Za-z0-9./\-]+)*)\s*:\s*(.+)$/;
/* a handful of lines drop the colon: "DN-8 Barasat to Sector V (Saltlake)" */
const NO_COLON_RE = /^((?:[A-Za-z]{1,3}[- ]?)?\d+[A-Za-z]?(?:\/\d+)?)\s+(.+)$/;

function parseRouteLine(line) {
  let no = null;
  let rest = line;

  const m = line.match(HEAD_RE);
  if (m) {
    no = m[1].replace(/\s+/g, " ").trim();
    rest = m[2];
  } else {
    const m2 = line.match(NO_COLON_RE);
    if (m2) {
      no = m2[1].replace(/\s+/g, " ").trim();
      rest = m2[2];
    }
  }

  // "VS1:- Airport …" — the dash after the colon is punctuation, not a range
  rest = rest.replace(/^\s*[-\u2013\u2014]+\s*/, "").trim();
  if (!rest) return null;

  let head = rest;
  let viaBlob = "";

  const bracket = rest.match(/\[([^\]]*)\]\s*$/);
  const viaWord = rest.match(/\s+via\b\s*:?\s*/i);

  if (bracket) {
    head = rest.slice(0, bracket.index).trim();
    viaBlob = bracket[1].replace(/^[^A-Za-z0-9]*/, "").replace(/^via\s*:?\s*/i, "");
  } else if (viaWord) {
    head = rest.slice(0, viaWord.index).trim();
    viaBlob = rest.slice(viaWord.index + viaWord[0].length);
  }

  // split origin from destination: "A to B", "A -> B", or "A - B"
  let from, to;
  const arrow = head.split(/\s*(?:->|\u2192|=>)\s*/);
  const toWord = head.match(/\s+to\s+/i);
  const dash = head.match(/\s+[-\u2013\u2014]\s+/);

  if (arrow.length >= 2) {
    from = arrow[0];
    to = arrow.slice(1).join(" ");
  } else if (toWord) {
    from = head.slice(0, toWord.index);
    to = head.slice(toWord.index + toWord[0].length);
  } else if (dash) {
    from = head.slice(0, dash.index);
    to = head.slice(dash.index + dash[0].length);
  } else {
    return null;
  }

  from = cleanStop(from).replace(/^-+\s*/, "");
  to = cleanStop(to).replace(/^-+\s*/, "");
  if (!from || !to || from.length > 42 || to.length > 42) return null;

  /* Numberless RTA / STA permits are known by their two ends
     ("Barasat-Baruipur"), not by a number, and the page lists them that
     way. Only accept those when a via list proves it is a route line,
     otherwise page furniture like "Use tab to navigate…" sneaks in. */
  if (!no) {
    if (viaBlob.split(",").filter((s) => cleanStop(s)).length < 2) return null;
    no = from + " \u2013 " + to;
  }

  return { no, from, to, viaBlob };
}

/* Section headings on these two pages. An allowlist beats guessing:
   the page furniture is full of short lines that look like headings. */
const SECTION_RE =
  /^(Blue-Yellow Buses|200 Series|Mini Series|SD Series|DN Series|K and KB|M and MM|E series|STA|Routes operated by|Non AC series|D & E Series|Private Buses|Government Bus)/i;
/* stop-name cleanup: drop the trailing period these lists sprinkle everywhere,
   normalise the recurring shorthand, and drop pure noise */
function cleanStop(raw) {
  let s = raw
    .replace(/\.\s*$/, "")
    .replace(/^[.\s:;,/|]+|[.\s:;,/|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "";
  if (/^\d+$/.test(s)) return "";
  if (s.length < 3) return "";
  if (/^(via|and|etc|more|rd|road|st|station)$/i.test(s)) return "";
  if (/^(v\/?s|vs)$/i.test(s)) return "";

  // the source writes "via:" again inside a few bundles
  s = s.replace(/^via\s*:?\s*/i, "").trim();
  return s;
}

function splitStops(blob) {
  return blob
    .split(/[,;]/)
    .map(cleanStop)
    .filter(Boolean);
}

function keyOf(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\bno\.?\b/g, "no")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const routes = [];
const seen = new Set();
const sectionCounts = {};

for (const { file, list } of SOURCES) {
  if (!fs.existsSync(file)) {
    console.error("!! missing " + file + " — skipping");
    continue;
  }
  const text = stripTags(fs.readFileSync(file, "utf8"));

  let section = list === "private" ? "Private" : "Government";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().replace(/\u200b/g, "").trim();
    if (!line) continue;

    // headings become the section label so private / minibus / district
    // buses stay distinguishable in the data and in the report
    if (line.length <= 70 && !/\s+to\s+/i.test(line) && SECTION_RE.test(line)) {
      section = line.replace(/\s+/g, " ");
      continue;
    }

    const parsed = parseRouteLine(line);
    if (!parsed) continue;

    const no = parsed.no;
    const from = parsed.from;
    const to = parsed.to;
    const viaBlob = parsed.viaBlob;
    const stops = [];
    const push = (n) => {
      if (!n) return;
      const prev = stops[stops.length - 1];
      if (prev && keyOf(prev) === keyOf(n)) return;
      stops.push(n);
    };
    push(from);
    splitStops(viaBlob).forEach(push);
    push(to);

    if (stops.length < 2) continue;
    if (!from || !to) continue;

    const id = keyOf(no) + "->" + keyOf(from) + "|" + keyOf(to);
    if (seen.has(id)) continue;
    seen.add(id);

    sectionCounts[section] = (sectionCounts[section] || 0) + 1;
    routes.push({ no, from, to, stops, section, list, source: "kolbusopedia" });
  }
}

fs.writeFileSync("tools/cache/routes.extra.json", JSON.stringify(routes, null, 2));

const allStops = new Set();
routes.forEach((r) => r.stops.forEach((s) => allStops.add(s)));

console.log("extra routes parsed:", routes.length);
console.log("distinct stop strings:", allStops.size);
console.log("\n--- per section ---");
Object.entries(sectionCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([s, n]) => console.log(String(n).padStart(4), s));

console.log("\n--- first 6 parsed ---");
routes.slice(0, 6).forEach((r) => {
  console.log(`  ${r.no}  ${r.from} -> ${r.to}   (${r.stops.length} stops)`);
  console.log(`      ${r.stops.slice(0, 12).join(" > ")}`);
});

/* sanity: the three routes the user actually asked about */
["S-3W", "C8", "EB16", "EB-16", "S3W"].forEach((n) => {
  const hits = routes.filter((r) => keyOf(r.no) === keyOf(n));
  console.log(`\nlookup ${n}: ${hits.length ? hits.map((h) => h.from + " -> " + h.to).join(" ; ") : "not on this source"}`);
});
