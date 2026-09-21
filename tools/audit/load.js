/* Load the generated dataset for inspection.
   js/data.js is plain browser script (const declarations, unquoted keys), so it
   is evaluated in a bare VM context rather than JSON.parse'd. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILE = path.join(__dirname, "..", "..", "js", "data.js");

function loadData(file) {
  const src = fs.readFileSync(file || FILE, "utf8");
  const ctx = {};
  vm.createContext(ctx);
  // `const` at script top level lives in the script's lexical scope, not on the
  // context object, so hand the bindings out explicitly from inside the script.
  vm.runInContext(
    src + "\n;globalThis.__data = { KOLKATA_STOPS, BUS_STOPS, STOP_ALIASES, STOP_AREAS, BUS_ROUTES };\n",
    ctx,
    { filename: "data.js" }
  );
  const g = ctx.__data || {};
  return {
    stops: g.KOLKATA_STOPS,
    busStops: g.BUS_STOPS,
    aliases: g.STOP_ALIASES,
    areas: g.STOP_AREAS,
    routes: g.BUS_ROUTES,
  };
}

/** resolve a typed name the way the app does */
function resolve(data, typed) {
  const key = String(typed || "").trim().toLowerCase();
  const lookup = new Map(data.busStops.map((s) => [s.toLowerCase(), s]));
  if (lookup.has(key)) return lookup.get(key);
  if (data.aliases[key]) return data.aliases[key];
  return data.aliases[key.replace(/[^a-z0-9]/g, "")] || null;
}

/** every route serving both stops, shortest stretch first
 *
 *  NOTE: this is a plain name-match over the raw dataset. It does NOT reproduce
 *  the app, which also folds locality names (Joka, Salt Lake Sector V, New Town,
 *  Thakurpukur) onto their member stops and matches the stretch in both
 *  directions. So a count here is a LOWER BOUND, and 0 here does not mean the
 *  app finds nothing — e.g. "Salt Lake Sector V -> Thakurpukur" is 0 here but 4
 *  in the app. For app behaviour, drive index.html in a real browser (see the
 *  --setup/--diag recipe in the browser-visual-verify skill).
 */
function findRoutes(data, from, to) {
  const a = resolve(data, from);
  const b = resolve(data, to);
  if (!a || !b) return { from: a, to: b, rows: [] };
  const rows = [];
  data.routes.forEach((r) => {
    const i = r.stops.indexOf(a);
    const j = r.stops.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    const n = r.stops.length - 1;
    rows.push({
      no: r.no,
      operator: r.operator,
      minutes: Math.round(r.duration * (Math.abs(j - i) / n)),
      km: Number((r.km * (Math.abs(j - i) / n)).toFixed(1)),
      stops: Math.abs(j - i) + 1,
    });
  });
  rows.sort((x, y) => x.minutes - y.minutes || x.km - y.km || x.no.localeCompare(y.no, undefined, { numeric: true }));
  return { from: a, to: b, rows };
}

module.exports = { loadData, resolve, findRoutes, FILE };
