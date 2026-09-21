/* Audit: find stops where the source table glued two published stops together */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const D = new Function(
  fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8") +
  ";return {KOLKATA_STOPS, BUS_STOPS, STOP_AREAS, BUS_ROUTES};"
)();

const keyOf = (n) =>
  String(n).toLowerCase().replace(/\bno\.?\b/g, "no")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const names = D.BUS_STOPS;
const byKey = new Map();
names.forEach((n) => { if (!byKey.has(keyOf(n))) byKey.set(keyOf(n), n); });

console.log("=== stops that look like two published stops glued together ===");
let hits = 0;
names.forEach((full) => {
  const n = full.length;
  if (n < 10) return;
  for (let i = 4; i <= n - 4; i++) {
    if (full[i] !== " ") continue;
    const left = full.slice(0, i).trim();
    const right = full.slice(i + 1).trim();
    const L = byKey.get(keyOf(left)), R = byKey.get(keyOf(right));
    if (!L || !R || L === full || R === full) continue;
    console.log("  " + JSON.stringify(full) + "   =   " + JSON.stringify(L) + "  +  " + JSON.stringify(R));
    hits++;
    break;
  }
});
console.log("total:", hits);
