/* ============================================================
   Audit geocoded coordinates before they go anywhere near the site.
   Run after stage 2:  node tools/verify-coords.js

   This is what caught Narkel Bagan landing in Baghajatin and Garia
   sitting 9 km from Garia — the whole reason the map only plots
   stops that pass these checks.
   ============================================================ */
const fs = require("fs");
const coords = JSON.parse(fs.readFileSync("tools/cache/coords.json", "utf8"));

/* Audit every route from every source: the geocoder's candidate coordinates are
   judged against the routes they are used on, so the wider the set, the more
   chances a misplaced candidate has to reveal itself. */
const routes = ["wbtc", "kolbusopedia", "manual"]
  .map((s) => "tools/cache/routes.canonical." + s + ".json")
  .filter((f) => fs.existsSync(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));

const haversine = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/* --- 1. spot-check well-known landmarks against hand-known positions --- */
const ANCHORS = {
  "Howrah Station": [22.5839, 88.3425],
  "Esplanade": [22.5646, 88.3517],
  "Sealdah": [22.5675, 88.3697],
  "Salt Lake": [22.5726, 88.4318],
  "Science City": [22.5400, 88.4000],
  "Airport": [22.6547, 88.4467],
  "Barasat": [22.7221, 88.4806],
  "Barrackpore": [22.7600, 88.3700],
  "Thakurpukur": [22.4644, 88.3075],
  "Joka": [22.4526, 88.2977],
  "Garia": [22.4655, 88.3930],
  "BBD Bag": [22.5697, 88.3477],
  "Tollygunge": [22.4989, 88.3459],
  "Gariahat": [22.5180, 88.3650],
  "Ruby Hospital": [22.5100, 88.4000],
  "Ultadanga": [22.5900, 88.3900],
  "Dum Dum Station": [22.6200, 88.4200],
  "Madhyamgram": [22.7000, 88.4500],
  "Behala Chowrasta": [22.5000, 88.3200],
  "Chingrighata": [22.5580, 88.4113],
  "Narkel Bagan": [22.5786, 88.4717],
  "Baruipur": [22.3650, 88.4320],
  "Dalhousie": [22.5660, 88.3450],
  "Park Street": [22.5535, 88.3517],
  "Karunamoyee": [22.5850, 88.4150],
  "New Town": [22.5800, 88.4600],
  "Eco Space": [22.5770, 88.4570],
  "Mominpur": [22.5400, 88.3200],
  "Khidderpore": [22.5500, 88.3200],
  "Hastings": [22.5450, 88.3250],
  "Guwahati": [0, 0],
};

console.log("=== anchor check (distance from a hand-known position) ===");
let worst = [];
Object.entries(ANCHORS).forEach(([name, known]) => {
  const c = coords[name];
  if (!c) return void worst.push([name, "NOT GEOCODED", 0]);
  const d = haversine(known, [c.lat, c.lng]);
  worst.push([name, d.toFixed(2) + " km", `${c.lat},${c.lng}`]);
});
worst.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
worst.forEach(([n, d, p]) => console.log(`  ${String(d).padStart(12)}  ${n.padEnd(22)} ${p}`));

/* --- 2. route geometry: flag stops that sit absurdly far from their neighbours --- */
console.log("\n=== route geometry outliers (stop > 12 km from BOTH neighbours) ===");
let flagged = 0;
routes.forEach((r) => {
  const pts = r.stops.map((s) => (coords[s] ? [coords[s].lat, coords[s].lng] : null));
  for (let i = 1; i < pts.length - 1; i++) {
    if (!pts[i] || !pts[i - 1] || !pts[i + 1]) continue;
    const a = haversine(pts[i - 1], pts[i]);
    const b = haversine(pts[i], pts[i + 1]);
    if (a > 12 && b > 12) {
      console.log(`  ${r.no.padEnd(16)} ${r.stops[i]}  (prev ${a.toFixed(1)} km, next ${b.toFixed(1)} km)`);
      flagged++;
    }
  }
});
console.log("flagged:", flagged);

/* --- 3. how much of each route is actually plottable? --- */
console.log("\n=== plottable coverage per route ===");
let far = 0;
routes.forEach((r) => {
  const have = r.stops.filter((s) => coords[s]).length;
  const pct = Math.round((have / r.stops.length) * 100);
  if (pct < 40) {
    console.log(`  ${r.no.padEnd(16)} ${have}/${r.stops.length} (${pct}%)`);
    far++;
  }
});
console.log("routes with <40% of stops plottable:", far, "of", routes.length);

/* --- 4. duplicate coordinates (two different stops at the exact same point) --- */
const byPoint = new Map();
Object.entries(coords).forEach(([n, c]) => {
  if (!c) return;
  const k = c.lat + "," + c.lng;
  if (!byPoint.has(k)) byPoint.set(k, []);
  byPoint.get(k).push(n);
});
const dupes = [...byPoint.values()].filter((v) => v.length > 1);
console.log("\n=== distinct stops sharing an identical point ===", dupes.length);
dupes.slice(0, 25).forEach((v) => console.log("  " + v.join(" | ")));
