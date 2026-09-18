/* ============================================================
   Stage 1 — official WBTC table -> ordered stop sequences.

   Input : tools/cache/routes.html  (download with
             curl -sL https://wbtconline.in/wbtc-city-bus-routes \
               -o tools/cache/routes.html )
   Output: tools/cache/routes.raw.json  + a variant report on stdout

   WBTC's stoppage column is free text with inconsistent separators,
   so this is where the messy splitting happens. Anything it can't
   split cleanly is left for the alias table in stage 2.
   ============================================================ */
const fs = require("fs");

const html = fs.readFileSync("tools/cache/routes.html", "utf8");

function decode(s) {
  return s
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

const routes = [];
for (const row of rows) {
  const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1]));
  if (cells.length < 5) continue;
  const [sl, no, from, to, via] = cells;
  if (!/^\d+$/.test(sl)) continue;
  routes.push({ no, from, to, via });
}

/* split a free-text stoppage blob into atomic names */
function splitStops(text) {
  return text
    .split(/\s*(?:,|;|\/|\||\u2192|->|->)\s*/)
    .flatMap((chunk) => chunk.split(/\s*-\s*|\s+-\s*/))
    .flatMap((chunk) => chunk.split(/\s*[-–—]\s*/))
    .flatMap((chunk) => chunk.split(/\bvia\b|\bVIA\b|\bVia\b/i))
    .map((t) =>
      t
        .replace(/&mdash;/gi, "")
        .replace(/[.\u2026]+$/g, "")
        .replace(/^[\s.:;,\-–—]+|[\s.:;,\-–—]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((t) => t.length > 2)
    .filter((t) => !/^\d+$/.test(t));
}

/* punctuation-insensitive grouping key */
function keyOf(name) {
  return name
    .toLowerCase()
    .replace(/\bno\.?\b/g, "no")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const variants = new Map(); // key -> Map(display -> count)
const perRoute = [];

routes.forEach((r) => {
  const seq = [];
  const push = (n) => {
    const c = n.replace(/\s+/g, " ").trim();
    if (c.length > 2) seq.push(c);
  };
  push(r.from.replace(/\bto$/i, ""));
  splitStops(r.via).forEach(push);
  push(r.to);

  // drop consecutive duplicates (case-insensitive) and the "circuitous" filler
  const cleaned = [];
  seq.forEach((s) => {
    if (/^circuitous/i.test(s)) return;
    const prev = cleaned[cleaned.length - 1];
    if (prev && keyOf(prev) === keyOf(s)) return;
    cleaned.push(s);
  });

  perRoute.push({ no: r.no.trim(), stops: cleaned });

  cleaned.forEach((s) => {
    const k = keyOf(s);
    if (!k) return;
    if (!variants.has(k)) variants.set(k, new Map());
    const m = variants.get(k);
    m.set(s, (m.get(s) || 0) + 1);
  });
});

fs.writeFileSync("tools/cache/routes.raw.json", JSON.stringify(perRoute, null, 2));

const sorted = [...variants.entries()].sort(
  (a, b) => [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0)
);

console.log("routes:", perRoute.length);
console.log("unique stop keys:", sorted.length);

const multi = sorted.filter(([, m]) => m.size > 1);
console.log("keys with >1 spelling variant:", multi.length);
console.log("\n--- keys where spellings differ (these need aliasing) ---");
multi.forEach(([k, m]) => {
  const total = [...m.values()].reduce((x, y) => x + y, 0);
  console.log(String(total).padStart(3), k.padEnd(34), "|", [...m.keys()].join(" ; "));
});

console.log("\n--- all keys, frequency order (first 140) ---");
sorted.slice(0, 140).forEach(([k, m]) => {
  const total = [...m.values()].reduce((x, y) => x + y, 0);
  console.log(String(total).padStart(3), k);
});

console.log("\n--- remaining keys (141+) ---");
sorted.slice(140).forEach(([k, m]) => {
  const total = [...m.values()].reduce((x, y) => x + y, 0);
  console.log(String(total).padStart(3), k);
});
