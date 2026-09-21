/* Audit: find duplicate / near-duplicate stop names in js/data.js */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
const sandbox = {};
const fn = new Function(
  src + "\n;return {KOLKATA_STOPS, BUS_STOPS, STOP_AREAS, BUS_ROUTES};"
);
const D = fn();

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const words = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/* strip generic tokens for a "core" comparison */
const GENERIC = new Set([
  "stop", "stn", "station", "bus", "stand", "more", "crossing", "bazar", "bazaar",
  "road", "rd", "no", "the", "and", "via", "opp", "opposite", "near", "halt",
  "busstand", "busstop", "terminus", "depot", "gate", "bagan", "tala", "para",
  "pukur", "pukur", "bridge", "setu", "hut", "bldg", "building", "hospital", "hsptl"
]);
const core = (s) => words(s).filter((w) => !GENERIC.has(w)).join("");

const stops = D.BUS_STOPS;
console.log("total BUS_STOPS:", stops.length);
console.log("total KOLKATA_STOPS:", Object.keys(D.KOLKATA_STOPS).length);
console.log("total routes:", D.BUS_ROUTES.length);

/* ---- 1. exact-normalised collisions ---- */
const byNorm = new Map();
stops.forEach((s) => {
  const k = norm(s);
  if (!byNorm.has(k)) byNorm.set(k, []);
  byNorm.get(k).push(s);
});
const exact = [...byNorm.entries()].filter(([, v]) => v.length > 1);
console.log("\n=== 1. identical after normalisation (" + exact.length + ") ===");
exact.forEach(([k, v]) => console.log("  " + k + "  =>  " + JSON.stringify(v)));

/* ---- 2. identical after dropping generic words ---- */
const byCore = new Map();
stops.forEach((s) => {
  const k = core(s);
  if (!k) return;
  if (!byCore.has(k)) byCore.set(k, []);
  byCore.get(k).push(s);
});
const coreHits = [...byCore.entries()]
  .filter(([, v]) => v.length > 1)
  .sort((a, b) => b[1].length - a[1].length);
console.log("\n=== 2. same core words (" + coreHits.length + ") ===");
coreHits.forEach(([k, v]) => console.log("  " + k + "  =>  " + JSON.stringify(v)));

/* ---- 3. one is a prefix/substring of the other ---- */
console.log("\n=== 3. substring pairs (one name contained in the other) ===");
const seen = new Set();
for (let i = 0; i < stops.length; i++) {
  for (let j = 0; j < stops.length; j++) {
    if (i === j) continue;
    const a = stops[i], b = stops[j];
    const na = norm(a), nb = norm(b);
    if (na.length < 3) continue;
    if (nb.includes(na) && nb.length > na.length && nb.length - na.length <= 14) {
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      console.log("  " + JSON.stringify(a) + "  <  " + JSON.stringify(b));
    }
  }
}

/* ---- 4. distinct names that share an identical coordinate ---- */
const byCoord = new Map();
Object.entries(D.KOLKATA_STOPS).forEach(([n, c]) => {
  const k = c[0].toFixed(5) + "," + c[1].toFixed(5);
  if (!byCoord.has(k)) byCoord.set(k, []);
  byCoord.get(k).push(n);
});
const coordHits = [...byCoord.entries()].filter(([, v]) => v.length > 1);
console.log("\n=== 4. same coordinate, different names (" + coordHits.length + ") ===");
coordHits.forEach(([k, v]) => console.log("  " + k + "  =>  " + JSON.stringify(v)));

/* ---- 5. coordinates within 120 m of each other ---- */
function hav(a, b) {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLng = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const coords = Object.entries(D.KOLKATA_STOPS);
const near = [];
for (let i = 0; i < coords.length; i++) {
  for (let j = i + 1; j < coords.length; j++) {
    const d = hav(coords[i][1], coords[j][1]);
    if (d * 1000 <= 150) near.push([coords[i][0], coords[j][0], (d * 1000).toFixed(0)]);
  }
}
console.log("\n=== 5. plotted stops within 150 m (" + near.length + ") ===");
near.sort((a, b) => a[2] - b[2]).forEach(([a, b, d]) => console.log("  " + d + " m  " + JSON.stringify(a) + " ~ " + JSON.stringify(b)));

/* ---- 6. STOP_AREAS ---- */
console.log("\n=== 6. STOP_AREAS ===");
Object.entries(D.STOP_AREAS).forEach(([k, v]) => {
  const missing = v.filter((m) => !stops.includes(m));
  console.log("  " + k + " -> " + JSON.stringify(v) + (missing.length ? "   MISSING: " + JSON.stringify(missing) : ""));
  const hasOwn = stops.includes(k);
  if (!hasOwn) console.log("     (area name is not itself a stop)");
});
