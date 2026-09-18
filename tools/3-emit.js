/* ============================================================
   Stage 3 — merge every route source and emit js/data.js.

   INPUTS (all produced by stages 1, 1b and 2)
     tools/cache/routes.canonical.wbtc.json          WBTC published city-route table
     tools/cache/routes.canonical.kolbusopedia.json  Kolkata Bus-O-Pedia catalogue
                                                     (private, minibus, C/D/E, K/KB,
                                                      M/MM/MN, SD/DN, STA)
     tools/cache/routes.canonical.manual.json        hand-curated newer services
     tools/anchors.json                              hand-verified coordinates
     tools/cache/coords.json                         geocoder output (audited below)

   WHAT IS REAL
     - route numbers, origins, termini and stop sequences, each attributed to
       the list it came from (the `src` field on every route)
   WHAT IS DERIVED
     - km via the verified stops x a road factor; duration from km at an
       assumed average city speed
   WHAT IS AN ASSUMED DEFAULT (no source publishes frequencies)
     - headway, first, last — flagged `est: true` and labelled in the UI
   COORDINATES
     Anchored stops only, plus geocoded stops that survive the neighbour test.
     A stop with no coordinate is still fully searchable; it just isn't plotted.
   ============================================================ */
const fs = require("fs");

const ROAD_FACTOR = 1.35;
const AVG_KMH = 17;
const MIN_KM_PER_HOP = 1.4;
const SYNONYM_MAX_KM = 1.2; // two spellings further apart than this are different places

const keyOf = (n) =>
  String(n).toLowerCase().replace(/&/g, "and").replace(/\bno\.?\b/g, "no")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------ */
/* 1. load every source, best-supported list wins on a clash     */
/* ------------------------------------------------------------ */
const SOURCE_FILES = [
  { src: "wbtc", file: "tools/cache/routes.canonical.wbtc.json", label: "WBTC" },
  { src: "manual", file: "tools/cache/routes.canonical.manual.json", label: "operator notices" },
  { src: "kolbusopedia", file: "tools/cache/routes.canonical.kolbusopedia.json", label: "Kolbusopedia" },
];

const all = [];
const sourceCount = {};
for (const s of SOURCE_FILES) {
  if (!fs.existsSync(s.file)) {
    console.error("!! missing " + s.file + " — run the earlier stages first");
    process.exit(1);
  }
  const list = JSON.parse(fs.readFileSync(s.file, "utf8"));
  sourceCount[s.src] = list.length;
  list.forEach((r) => all.push({ ...r, src: s.src }));
}

/* A bus number can appear in both lists. Two copies would be wrong, so one is
   kept: the list that names more stops, because the point of the dataset is
   answering "which bus gets me there", and a richer published stoppage list
   answers more trips. Interleaving the two lists was tried and rejected — the
   lists name the same places differently, so the merged order came out
   zig-zagging and the route lines were worse than either source alone. */
const byNumber = new Map();
let dropped = 0;
let preferred = 0;
for (const r of all) {
  const k = keyOf(r.no);
  if (!k) { dropped++; continue; }
  const prev = byNumber.get(k);
  if (!prev) { byNumber.set(k, { ...r, srcs: [r.src] }); continue; }
  dropped++;
  if (r.stops.length > prev.stops.length) {
    byNumber.set(k, { ...r, srcs: [...new Set([...prev.srcs, r.src])] });
    preferred++;
  } else {
    prev.srcs = [...new Set([...prev.srcs, r.src])];
  }
}
const merged = [...byNumber.values()];
console.log("routes in:", JSON.stringify(sourceCount), "-> kept", merged.length,
  "| duplicate numbers:", dropped, "(richer stop list kept for", preferred + ")");

/* ------------------------------------------------------------ */
/* 2. stop spellings: one place, several names                   */
/* ------------------------------------------------------------ */
const STOP_FIXES = [
  [/^Science City Chingrighata$/i, ["Science City", "Chingrighata"]],
  [/^Chingrihata$/i, ["Chingrighata"]],
  [/^Chinghreeghata$/i, ["Chingrighata"]],
  [/^Techopolic$/i, ["Technopolis"]],
  [/^Technopolish$/i, ["Technopolis"]],
  [/^Aliah Univercity$/i, ["Aliah University"]],
  [/^Ecispace$/i, ["Eco Space"]],
  [/^Narkelbagn$/i, ["Narkel Bagan"]],
  [/^Sec5$|^Sector 5$|^Sector V \(Saltlake\)$/i, ["Salt Lake Sector V"]],
  [/^Salt Lake$/i, ["Salt Lake"]],
  [/^Sakhar Bazar$/i, ["Sakherbazar"]],
  [/^Chourasta$|^Chowrastha$/i, ["Behala Chowrasta"]],
  [/^Chowrasta$/i, ["Behala Chowrasta"]],
  [/^Menton$|^Manton Xing$/i, ["Manton"]],
  [/^RB Av xing$|^R\.B\.Ave$/i, ["RB Avenue"]],
  [/^P\.T\.S$/, ["PTS"]],
  [/^Casurina Ave$/i, ["Casurina Avenue"]],
  [/^B\.T\.Colleg$/i, ["BT College"]],
  [/^Airpport$/i, ["Airport"]],
  [/^More$/, []],
  [/^Sanpui Para$/i, ["Sapuipara"]],
  [/^Metro politon Hou\. Est$/i, ["Metropolitan"]],
  [/^22\.?\s*$/i, []],
];

function fixStops(seq) {
  const out = [];
  for (const raw of seq) {
    let placed = false;
    for (const [re, repl] of STOP_FIXES) {
      if (re.test(raw)) {
        repl.forEach((r) => { if (out[out.length - 1] !== r) out.push(r); });
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (out[out.length - 1] !== raw) out.push(raw);
  }
  return out;
}

/* Verified coordinates, from the committed anchor file. Never read these back
   out of js/data.js: this script overwrites that file, so doing so would feed
   generated coordinates in as "verified". */
const ANCHORS_FILE = "tools/anchors.json";
let legacy = {};
try {
  legacy = JSON.parse(fs.readFileSync(ANCHORS_FILE, "utf8"));
} catch (e) {
  console.error("!! could not read " + ANCHORS_FILE + " — refusing to guess anchors");
  process.exit(1);
}
if (!Object.keys(legacy).length) {
  console.error("!! " + ANCHORS_FILE + " is empty — refusing to emit unverified coordinates");
  process.exit(1);
}

const LEGACY_MAP = {
  "Salt Lake Sector V": "Salt Lake Sector V",
  "Rajarhat New Town": "New Town",
  "Airport (CCU)": "Airport",
  "BBD Bagh": "BBD Bag",
  "Dum Dum": "Dum Dum Station",
  "Ruby": "Ruby Hospital",
};
const ANCHORS = {};
Object.entries(legacy).forEach(([name, c]) => {
  const canonical = LEGACY_MAP[name] || name;
  if (c && typeof c.lat === "number") ANCHORS[canonical] = [c.lat, c.lng];
});

/* Extra anchors for hub stops the tables need and that can be placed with
   confidence from the street grid. Deliberately conservative. */
Object.assign(ANCHORS, {
  "Barasat": [22.7221, 88.4806],
  "Barrackpore": [22.7600, 88.3700],
  "Baruipur": [22.3650, 88.4320],
  "Sonarpur": [22.4400, 88.4200],
  "Narendrapur": [22.4400, 88.4000],
  "Baruipur New Terminus": [22.3650, 88.4320],
  "Joka": [22.4526, 88.2977],
  "Thakurpukur": [22.4644, 88.3075],
  "Thakurpukur 3A": [22.4567, 88.3043],
  "Amtala": [22.4300, 88.2760],
  "Budge Budge": [22.4800, 88.2700],
  "Metiabruz": [22.5500, 88.2900],
  "Garden Reach": [22.5500, 88.3000],
  "Hastings": [22.5450, 88.3250],
  "Nabanna": [22.5750, 88.3350],
  "Santragachi": [22.5750, 88.2800],
  "Bhattanagar": [22.6350, 88.2900],
  "Howrah Maidan": [22.5900, 88.3300],
  "Belur Math": [22.6300, 88.3500],
  "Dakshineswar": [22.6550, 88.3600],
  "Kamarhati": [22.6600, 88.3700],
  "Panihati": [22.6900, 88.3800],
  "Sodepur": [22.7000, 88.3800],
  "Khardah": [22.7200, 88.3800],
  "Titagarh": [22.7400, 88.3700],
  "Habra": [22.8345, 88.6440],
  "Duttapukur": [22.8600, 88.5300],
  "Ashoknagar": [22.7900, 88.5000],
  "Madhyamgram": [22.7000, 88.4500],
  "Birati": [22.6700, 88.4200],
  "Michael Nagar": [22.6350, 88.4100],
  "Nager Bazar": [22.6200, 88.4000],
  "Lake Town": [22.6050, 88.4000],
  "Bangur": [22.6100, 88.4050],
  "Kestopur": [22.6000, 88.4300],
  "Baguiati": [22.6100, 88.4300],
  "Chinar Park": [22.6100, 88.4500],
  "Kaikhali": [22.6400, 88.4300],
  "Airport": [22.6547, 88.4467],
  "Eco Space": [22.5770, 88.4570],
  "Eco Park": [22.6000, 88.4600],
  "Narkel Bagan": [22.5786, 88.4717],
  "New Town": [22.5800, 88.4600],
  "Aliah University": [22.5830, 88.4600],
  "Unitech": [22.5810, 88.4640],
  "Home Town": [22.5800, 88.4650],
  "Axis Mall": [22.5950, 88.4670],
  "Rabindra Tirtha": [22.5900, 88.4700],
  "Infosys Hatishala": [22.5930, 88.4780],
  "Nicco Park": [22.5730, 88.4130],
  "Sukanta Nagar": [22.5750, 88.4070],
  "SDF": [22.5750, 88.4300],
  "Technopolis": [22.5730, 88.4350],
  "College More": [22.5800, 88.4200],
  "Swastha Bhavan": [22.5780, 88.4220],
  "Wipro": [22.5820, 88.4150],
  "Central Park": [22.5850, 88.4080],
  "City Centre I": [22.5930, 88.4050],
  "City Centre II": [22.6150, 88.4500],
  "HUDCO": [22.6000, 88.3950],
  "PNB": [22.5950, 88.4000],
  "Lake Gardens": [22.5050, 88.3550],
  "Kasba PS": [22.5150, 88.3850],
  "Topsia More": [22.5480, 88.3900],
  "Ballygunge": [22.5250, 88.3650],
  "Deshapriya Park": [22.5180, 88.3580],
  "Exide": [22.5450, 88.3450],
  "Elgin": [22.5400, 88.3480],
  "Bhowanipore": [22.5350, 88.3450],
  "Patuli": [22.4800, 88.4000],
  "Kamalgazi": [22.4500, 88.4100],
  "Dhalai Bridge": [22.4700, 88.4200],
  "Harinavi": [22.4200, 88.4300],
  "Padmapukur": [22.4000, 88.4300],
  "Peerless Hospital": [22.4800, 88.3900],
  "Ajoy Nagar": [22.4900, 88.3900],
  "Kalikapur": [22.5000, 88.3900],
  "Ruby Hospital": [22.5100, 88.4000],
  "VIP Bazar": [22.5200, 88.3950],
  "Bantala": [22.5300, 88.4300],
  "Hiland Park": [22.4850, 88.3930],
  "Mukundapur": [22.5000, 88.4000],
  "Anwar Shah Road": [22.5100, 88.3550],
  "Prince Anwar Shah Rd": [22.5080, 88.3520],
  "South City": [22.5020, 88.3640],
  "Kundghat": [22.4950, 88.3300],
  "Regent Park": [22.4850, 88.3600],
  "Naktala": [22.4800, 88.3650],
  "Baghajatin": [22.4750, 88.3800],
  "Ganguli Bagan": [22.4700, 88.3900],
  "Parnasree": [22.5100, 88.3100],
  "Sakuntala Park": [22.4900, 88.3050],
  "Sarsuna": [22.4800, 88.3050],
  "Haridevpur": [22.4900, 88.3400],
  "Manton": [22.5100, 88.3250],
  "James Long Sarani": [22.4970, 88.3400],
  "Behala": [22.5000, 88.3230],
  "Behala Tram Depot": [22.5050, 88.3230],
  "Behala PS": [22.5030, 88.3220],
  "Behala 14 No.": [22.4980, 88.3210],
  "Sakherbazar": [22.4870, 88.3230],
  "Kabardanga": [22.4820, 88.3350],
  "Silpara": [22.4700, 88.3200],
  "Majerhat": [22.5200, 88.3300],
  "Alipore Zoo": [22.5370, 88.3320],
  "Chetla": [22.5300, 88.3380],
  "New Alipore": [22.5250, 88.3350],
  "Mominpur": [22.5300, 88.3200],
  "Khidderpore": [22.5500, 88.3200],
  "Science City": [22.5400, 88.4000],
  "Chingrighata": [22.5587, 88.4108],
  "Ultadanga": [22.5900, 88.3900],
  "Gariahat": [22.5180, 88.3650],
  "Rashbehari": [22.5200, 88.3600],
  "RB Avenue": [22.5250, 88.3500],
  "Hazra": [22.5250, 88.3450],
  "Garia": [22.4655, 88.3930],
  "Dum Dum Station": [22.6210, 88.3930],
  "Bally Halt": [22.6450, 88.3450],
  "Durganagar": [22.6350, 88.4150],
  "Nimta": [22.6400, 88.4200],
  "Belghoria": [22.6500, 88.3800],
  "Dunlop": [22.6500, 88.3700],
  "Sinthee More": [22.6150, 88.3700],
  "Chiria More": [22.6350, 88.3800],
  "Rajchandrapur": [22.7100, 88.3300],
  "Nilgunge": [22.7400, 88.3800],
  "Lalkuthi": [22.7350, 88.3750],
  "Mohanpur": [22.7450, 88.3750],
  "BT College": [22.6800, 88.4200],
  "Hridaypur": [22.7100, 88.4600],
  "Dackbanglow More": [22.7150, 88.4700],
  "Champadali More": [22.7050, 88.4750],
  "Rathtala": [22.6600, 88.3650],
  "Talpukur": [22.7300, 88.3700],
  "Sukchar Monument": [22.7100, 88.3800],
  "Bonhooghly": [22.6450, 88.3700],
  "Tobin Road": [22.6400, 88.3700],
  "Ariadaha": [22.6600, 88.3700],
  "Bally": [22.6400, 88.3400],
  "Kona Expressway": [22.5900, 88.2800],
  "Salap": [22.6200, 88.2900],
  "Mandirtala": [22.5750, 88.3300],
  "Vidyasagar Setu": [22.5700, 88.3400],
  "Toll Plaza": [22.6000, 88.3200],
  "Sealdah": [22.5675, 88.3697],
  "Rajabazar": [22.5780, 88.3720],
  "Manicktala": [22.5870, 88.3730],
  "Kankurgachi": [22.5800, 88.3900],
  "Phool Bagan": [22.5750, 88.3900],
  "Beliaghata": [22.5680, 88.3880],
  "Park Circus": [22.5470, 88.3690],
  "Park Street": [22.5535, 88.3517],
  "Maidan Metro": [22.5560, 88.3480],
  "Esplanade": [22.5646, 88.3517],
  "BBD Bag": [22.5697, 88.3477],
  "Howrah Station": [22.5839, 88.3425],
  "Howrah Bridge East": [22.5850, 88.3470],
  "MG Road": [22.5730, 88.3500],
  "Dalhousie": [22.5660, 88.3450],
  "Burrabazar": [22.5800, 88.3500],
  "Moulali": [22.5610, 88.3650],
  "College Street": [22.5760, 88.3630],
  "Girish Park": [22.5900, 88.3650],
  "Shyambazar": [22.6000, 88.3700],
  "Sovabazar": [22.5950, 88.3650],
  "Lal Bazar": [22.5750, 88.3530],
  "Rabindra Sadan": [22.5450, 88.3450],
  "PTS": [22.5500, 88.3350],
  "Tollygunge": [22.4989, 88.3459],
  "Tollygunge Phari": [22.5000, 88.3500],
  "Jadavpur": [22.4990, 88.3710],
  "Golpark": [22.5100, 88.3650],
  "Dhakuria": [22.5100, 88.3700],
  "Kalighat": [22.5186, 88.3426],
  "Alipore": [22.5350, 88.3350],
  "Behala Chowrasta": [22.5000, 88.3200],
  "Taratala": [22.5100, 88.3200],
  "Salt Lake Sector V": [22.5726, 88.4318],
  "Salt Lake": [22.5850, 88.4100],
  "Karunamoyee": [22.5850, 88.4150],
  "Ranikuthi": [22.4900, 88.3570],
  "Budge Budge Bridge": [22.4700, 88.2600],
  "Maheshtala": [22.5000, 88.2600],
  "Nangi": [22.4900, 88.2900],
  "Akra": [22.5200, 88.2900],
  "Paharpur": [22.4850, 88.2950],
  "Batanagar": [22.5000, 88.2800],
  "Santoshpur": [22.4900, 88.3100],
  "GP Block": [22.5730, 88.4280],
  "Godrej Waterside": [22.5700, 88.4340],
  "Fire Brigade Sector V": [22.5720, 88.4330],
  "Minto Park": [22.5430, 88.3520],
  "Beckbagan": [22.5400, 88.3580],
  "Wellington Square": [22.5480, 88.3560],
  "Shibpur": [22.5800, 88.3200],
  "Dumdum Cantonment": [22.6300, 88.4000],
  "Bonhooghly": [22.6450, 88.3700],
});

const haversine = (a, b) => {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/* ---- apply the text fixes, build the vocabulary ---- */
let routes = merged.map((r) => ({ ...r, stops: fixStops(r.stops) })).filter((r) => r.stops.length >= 2);

const freq = new Map();
routes.forEach((r) => new Set(r.stops).forEach((s) => freq.set(s, (freq.get(s) || 0) + 1)));

/* ---- coordinates we can vouch for ---- */
const coords = JSON.parse(fs.readFileSync("tools/cache/coords.json", "utf8"));
const located = {};
Object.keys(ANCHORS).forEach((name) => {
  if (freq.has(name)) located[name] = { lat: ANCHORS[name][0], lng: ANCHORS[name][1], src: "anchor" };
});

/* ------------------------------------------------------------ */
/* 3. merge spellings of the same place                          */
/*    "Sealdah Station" and "Sealdah" are one place. Two names    */
/*    that both have coordinates and sit more than SYNONYM_MAX_KM */
/*    apart are NOT one place (Garia vs Garia Station), so they   */
/*    stay separate.                                             */
/* ------------------------------------------------------------ */
const NOISE = /\b(station|stn|more|crossing|busstand|busterminus|terminus|stand|stop|halt|ps|thana|corner)\b/g;
const coreKey = (name) => keyOf(name).replace(NOISE, " ").replace(/\s+/g, " ").trim();

/* Every way a name could be looked up:
     - as written ("Eco Space")
     - with the spacing flattened ("Ecospace", "Newtown", "B.T.College")
     - the name with any bracketed qualifier removed, because that qualifier is
       usually the locality the stop sits in ("Naktala (Garia)" is Naktala).

   The text *inside* the brackets is deliberately NOT used as a key: it often
   names a different place nearby — "Rabindra Sadan (Parnasree)",
   "Palbazar (Jadavpur Station)", "Sealdah (Rajabazar T.D.)" — and matching on
   it merged stops that are a kilometre or more apart. */
/* …except where the shared head word is a coincidence — there is a Rabindra
   Sadan in Parnasree and another in Kidderpore, and neither is the Cathedral
   Road one. Those keep their own names. */
const KEEP_SEPARATE = /rabindra sadan\s*\((parnasree|kidderpore|diamond park)\)/i;

function stemsOf(name) {
  const out = new Set();
  const add = (s) => {
    const k = coreKey(s);
    if (!k || k.length < 4) return;
    out.add(k);
    out.add(k.replace(/ /g, ""));
  };
  add(name);
  if (!KEEP_SEPARATE.test(name)) add(name.replace(/\([^)]*\)/g, " "));
  return [...out];
}

/* union-find, so one name bridging two stems joins all three together */
const parent = new Map();
const find = (x) => {
  while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
  return x;
};
const union = (a, b) => {
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
};

const stems = new Map();
for (const name of freq.keys()) {
  if (!parent.has(name)) parent.set(name, name);
  stemsOf(name).forEach((k) => {
    if (!stems.has(k)) stems.set(k, name);
    else union(name, stems.get(k));
  });
}

const groups = new Map();
for (const name of freq.keys()) {
  const root = find(name);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(name);
}

const rename = new Map();   // variant -> primary
const mergedPairs = [];
for (const [, members] of groups) {
  if (members.length < 2) continue;
  const ranked = members.slice().sort((a, b) => {
    const la = located[a] ? 0 : 1, lb = located[b] ? 0 : 1;
    if (la !== lb) return la - lb;                       // prefer a placed name
    if ((freq.get(b) || 0) !== (freq.get(a) || 0)) return (freq.get(b) || 0) - (freq.get(a) || 0);
    return a.length - b.length || a.localeCompare(b);
  });
  const primary = ranked[0];
  for (const m of ranked.slice(1)) {
    const pm = located[primary], mm = located[m];
    if (pm && mm) {
      const d = haversine([pm.lat, pm.lng], [mm.lat, mm.lng]);
      if (d > SYNONYM_MAX_KM) continue;                  // different places, keep both
    }
    rename.set(m, primary);
    mergedPairs.push([m, primary]);
  }
}

if (mergedPairs.length) {
  console.log("stop spellings merged:", mergedPairs.length);
  mergedPairs.slice(0, 30).forEach(([v, p]) => console.log("    " + v + "  ->  " + p));
  if (mergedPairs.length > 30) console.log("    … and " + (mergedPairs.length - 30) + " more");
}

if (rename.size) {
  routes = routes.map((r) => {
    const out = [];
    r.stops.forEach((s) => {
      const n = rename.get(s) || s;
      if (out[out.length - 1] !== n) out.push(n);
    });
    return { ...r, stops: out };
  }).filter((r) => r.stops.length >= 2);

  routes.forEach((r) => new Set(r.stops).forEach((s) => {
    if (!freq.has(s)) freq.set(s, 1);
  }));
}

/* coordinates follow the name they were merged into */
for (const [variant, primary] of rename) {
  const c = coords[variant];
  if (!located[primary] && c) located[primary] = { lat: c.lat, lng: c.lng, src: "geocode" };
}

/* ---- accept geocoded stops only when the geometry agrees ---- */
const rejected = [];
const neighbourCheck = (name, cand) => {
  let checks = 0;
  for (const r of routes) {
    const i = r.stops.indexOf(name);
    if (i === -1) continue;
    const nb = [];
    for (let j = i - 1; j >= 0 && nb.length < 1; j--) {
      const p = located[r.stops[j]];
      if (p) nb.push([p.lat, p.lng]);
    }
    for (let j = i + 1; j < r.stops.length && nb.length < 2; j++) {
      const p = located[r.stops[j]];
      if (p) nb.push([p.lat, p.lng]);
    }
    if (nb.length < 2) continue;
    checks++;
    const d = nb.map((n) => haversine([cand.lat, cand.lng], n));
    if (Math.min(...d) > 9) return false;
  }
  return checks > 0;
};

for (const name of freq.keys()) {
  if (located[name]) continue;
  const cand = coords[name];
  if (!cand) { rejected.push([name, "not geocoded"]); continue; }
  const clash = Object.entries(located).find(
    ([, p]) => Math.abs(p.lat - cand.lat) < 1e-4 && Math.abs(p.lng - cand.lng) < 1e-4
  );
  if (clash) { rejected.push([name, "collides with " + clash[0]]); continue; }
  if (!neighbourCheck(name, cand)) { rejected.push([name, "fails route-geometry check"]); continue; }
  located[name] = { lat: cand.lat, lng: cand.lng, src: "geocode" };
}

/* One stop name can mean two different places. Kolkata has two Mohanpurs, two
   Santoshpurs, two Padmapukurs and two Bishnupurs, and a geocoder picks one of
   them for every bus on both sides of the city. Anchors are not immune either:
   a hand-verified "Mohanpur" is only right for the routes that go there.

   The tell is context. For each occurrence of a name, take the midpoint of the
   stops either side of it on that route. If those midpoints split into groups
   tens of kilometres apart, one name is being used for two places, and we
   cannot plot it without lying about one of them — so it stays searchable but
   is no longer drawn. */
/* Per-occurrence test: on this route, is the stop roughly where the stops
   either side of it say it should be? A rural route can legitimately leave a
   stop 15 km from the midpoint of two far-apart neighbours, so the test scales
   with how far apart those neighbours are. */
const localVerdict = (name) => {
  const here = located[name];
  const p = [here.lat, here.lng];
  let ok = 0;
  const bad = [];
  for (const r of routes) {
    const i = r.stops.indexOf(name);
    if (i === -1) continue;
    let before = null, after = null;
    for (let j = i - 1; j >= 0; j--) { if (located[r.stops[j]]) { before = located[r.stops[j]]; break; } }
    for (let j = i + 1; j < r.stops.length; j++) { if (located[r.stops[j]]) { after = located[r.stops[j]]; break; } }
    if (!before || !after) continue;
    const a = [before.lat, before.lng], b = [after.lat, after.lng];
    const span = haversine(a, b);
    const dev = haversine(p, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    // off the line by more than 8 km AND out of proportion to the local spacing
    if (dev > 8 && dev > 3 * Math.max(span, 1)) bad.push(r.no + " (off by " + Math.round(dev) + " km)");
    else ok++;
  }
  return { ok, bad };
};

const demoted = [];
for (const name of Object.keys(located)) {
  const { ok, bad } = localVerdict(name);
  if (!bad.length) continue;
  // a one-off disagreement is usually the other stop being wrong; a name that
  // disagrees with most of the routes it is on is a name we cannot place
  const share = bad.length / (ok + bad.length);
  if (share <= 0.34) continue;
  demoted.push(name + " — " + bad.length + "/" + (ok + bad.length) + " routes disagree, e.g. " + bad[0]);
  delete located[name];
}
if (demoted.length) {
  console.log("coordinates dropped as unplaceable:", demoted.length);
  demoted.slice(0, 14).forEach((d) => console.log("    " + d));
}

/* ------------------------------------------------------------ */
/* 4. categories, operators, estimated timings                   */
/* ------------------------------------------------------------ */
const KM_EST = { electric: 20, ac: 30, nonac: 15 };
const SPAN = {
  nonac: { first: 300, last: 1350 },
  ac: { first: 360, last: 1320 },
  electric: { first: 360, last: 1320 },
};

function categoryOf(r) {
  const no = r.no;
  if (/^EB/i.test(no) || /electric/i.test(r.section || "")) return "electric";
  if (/^AC/i.test(no) || /^VS/i.test(no) || /^V-?\d/i.test(no) || /^ACT/i.test(no)) return "ac";
  if (/^M\d+\s*\(AC/i.test(no) || /\bAC\b/i.test(no)) return "ac";
  return "nonac";
}

/* Who runs it. Government or private comes from which list the route was
   published in and, for the catalogue, which section of it — not from the
   file name, or the WBTC services on the catalogue's government page would
   all be labelled private. */
function operatorOf(r) {
  const s = r.section || "";
  if (r.src === "wbtc") {
    if (/^EB/i.test(r.no)) return "WBTC Electric";
    if (/^C\d/i.test(r.no) || /^D\d/i.test(r.no) || /^E\b/i.test(r.no)) return "WBTC (CTC)";
    return "WBTC";
  }
  if (r.src === "manual") return "WBTC Electric";
  if (/^STA/i.test(s)) return "STA / RTA";
  if (/CSTC/i.test(s)) return "WBTC (CSTC)";
  if (/CTC/i.test(s)) return "WBTC (CTC)";
  if (/Surface|WBSTC/i.test(s)) return "WBSTC";
  if (/Mini/i.test(s)) return "Private (minibus)";
  if (/RTA|STA|DN Series|SD Series|200 Series/i.test(s)) return "Private";
  return "Private";
}

function typeOf(r) {
  const s = r.section || "";
  if (/^STA/i.test(s)) return "sta";
  if (r.src === "wbtc" || r.src === "manual") return "govt";
  return r.list === "govt" ? "govt" : "private";
}

/* Plot points in travel order, then measure them robustly.

   Summing the hops between consecutive stops assumes every stop is plotted
   where it really is. For a handful of rural names that isn't true (one
   "Mohanpur" is 36 km from another), and one bad point would add a phantom
   detour to the whole route. So the length is computed as the shortest path
   through the stops *in order*, where stepping over a stop costs SKIP_KM. A
   stop that genuinely sits on the way is cheaper to visit than to skip; a
   stop that would drag the line 20 km off course is not. */
const SKIP_KM = 0.35;

function pathKm(points) {
  const n = points.length;
  if (n < 2) return 0;
  const dp = new Array(n).fill(Infinity);
  dp[0] = 0;
  for (let i = 1; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const cost = dp[j] + haversine(points[j], points[i]) + SKIP_KM * (i - j - 1);
      if (cost < dp[i]) dp[i] = cost;
    }
  }
  return dp[n - 1];
}

const outRoutes = routes.map((r) => {
  const pts = r.stops.map((s) => located[s]).filter(Boolean).map((p) => [p.lat, p.lng]);
  const straight = pts.length > 1 ? pathKm(pts) : 0;
  const direct = pts.length > 1 ? haversine(pts[0], pts[pts.length - 1]) : 0;
  let km = Math.max(straight, direct);
  km = km > 0 ? km * ROAD_FACTOR : (r.stops.length - 1) * MIN_KM_PER_HOP;
  km = Math.max(1.5, Math.round(km * 10) / 10);
  const duration = Math.max(15, Math.round((km / AVG_KMH) * 60));
  const cat = categoryOf(r);
  const span = SPAN[cat];

  return {
    no: r.no,
    operator: operatorOf(r),
    type: typeOf(r),
    src: r.src,
    cat,
    ac: cat !== "nonac",
    headway: KM_EST[cat],
    first: span.first,
    last: span.last,
    km,
    duration,
    stops: r.stops,
    est: true,
  };
});

/* ------------------------------------------------------------ */
/* 5. search areas: one word for a whole neighbourhood           */
/*    People say "Sector V", not "SDF". A route that stops at    */
/*    any member of an area answers a search for that area; the  */
/*    map still plots the exact member stop.                     */
/* ------------------------------------------------------------ */
const AREA_DEFS = {
  "Salt Lake Sector V": [
    "Salt Lake Sector V", "SDF", "College More", "Technopolis", "Wipro",
    "Swastha Bhavan", "Godrej Waterside", "Fire Brigade Sector V", "GP Block",
    "Tank 10", "Techno India", "Nabadiganta", "Nabadiganta More",
  ],
  "New Town": [
    "New Town", "New Town (Sapoorji)", "Eco Space", "Narkel Bagan", "Unitech",
    "Home Town", "Aliah University", "Axis Mall", "Rabindra Tirtha", "DLF1",
    "City Centre II", "Chinar Park", "Eco Park", "Hidco Bhavan", "Jatragachi",
    "Nabadiganta", "Infosys Hatishala", "Sapoorji",
  ],
  // the terminus WBTC calls "Joka" is written out in full in the catalogue
  "Joka": ["Joka", "Thakurpukur 3A", "Joka ESI hospital"],
};

const vocab = new Set();
routes.forEach((r) => r.stops.forEach((s) => vocab.add(s)));

const STOP_AREAS = {};
Object.entries(AREA_DEFS).forEach(([area, members]) => {
  if (!vocab.has(area)) return;                    // the area name must be a real stop
  const present = members.filter((m) => vocab.has(m));
  const extraServed = present.length >= 2 && present.length >= members.filter((m) => vocab.has(m)).length;
  if (present.length >= 2 && extraServed) STOP_AREAS[area] = present;
});

/* ------------------------------------------------------------ */
/* 6. emit                                                       */
/* ------------------------------------------------------------ */
const allStops = [...vocab].sort((a, b) => a.localeCompare(b));

const header = `/* ============================================================
   BusBondhu — Kolkata bus dataset
   ------------------------------------------------------------
   AUTO-GENERATED. Do not edit by hand.
   Regenerate with:
     node tools/1-extract.js && node tools/1b-kolbusopedia.js &&
     node tools/2-geocode.js && node tools/3-emit.js

   ROUTES — from two published lists, attributed per route via \`src\`
     wbtc          https://wbtconline.in/wbtc-city-bus-routes   (${sourceCount.wbtc} routes)
     kolbusopedia  https://www.kolbusopedia.com/bus-routes    (private, minibus,
                   C/D/E, K/KB, M/MM/MN, SD/DN and STA services)
     manual        newer services that neither list publishes yet
   Route numbers, origins, termini and stop sequences are as published.
   Routes run BOTH ways; the reverse trip is generated, not stored twice.

   DERIVED (computed, not official)
     km        distance through the mapped stops x a road factor
     duration  km at an assumed average city speed of ${AVG_KMH} km/h

   ASSUMED (no source publishes frequencies or departure times)
     headway, first, last are estimates, flagged est:true and labelled
     as estimates in the UI. Never present them as official timings.

   COORDINATES
     Only stops we can vouch for are plotted (verified anchors, plus
     geocoded stops that pass a route-geometry check). A stop without a
     coordinate is still fully searchable, it just isn't plotted, so the
     map never invents a dot.

   STOP_AREAS
     A locality people search for by name ("Sector V") mapped to the
     stops inside it, so one bus that reaches any of them answers the
     search while the map still plots the exact stop.
   ============================================================ */

/* stop name -> [lat, lng] — verified positions only */
const KOLKATA_STOPS = {`;

const stopLines = Object.keys(located).sort((a, b) => a.localeCompare(b))
  .map((n) => `  ${JSON.stringify(n)}: [${located[n].lat}, ${located[n].lng}]`)
  .join(",\n");

const body = `${header}\n${stopLines}\n};\n
/* every stop that appears on a route, with or without coordinates */
const BUS_STOPS = ${JSON.stringify(allStops, null, 0)};

/* locality -> the stops inside it, for area-wide searches */
const STOP_AREAS = ${JSON.stringify(STOP_AREAS, null, 2)};

/* ------------------------------------------------------------
   Route shape:
     no        bus number as published (numberless STA services use
               their two ends, which is how people refer to them)
     operator  WBTC / WBTC (CSTC) / WBTC (CTC) / WBSTC / Private /
               Private (minibus) / STA / RTA
     type      "govt" | "private" | "sta"
     src       "wbtc" | "kolbusopedia" | "manual" — where this route is from
     cat       "ac" | "electric" | "nonac"  (drives the filters)
     ac        whether the service is air-conditioned
     headway   ESTIMATE: minutes between buses
     first     ESTIMATE: first departure from the route's first stop
     last      ESTIMATE: last departure from the route's first stop
     km        derived route length
     duration  derived end-to-end run time in minutes
     stops     ordered stop names
     est       true => headway/first/last are estimates, not official
   ------------------------------------------------------------ */
const BUS_ROUTES = [
`;

const routeLines = outRoutes.map((r) => {
  const stopList = r.stops.map((s) => JSON.stringify(s)).join(", ");
  const srcs = r.srcs && r.srcs.length > 1 ? `, srcs: ${JSON.stringify(r.srcs)}` : "";
  return `  { no: ${JSON.stringify(r.no)}, operator: ${JSON.stringify(r.operator)}, type: ${JSON.stringify(r.type)}, src: ${JSON.stringify(r.src)}${srcs}, cat: ${JSON.stringify(r.cat)}, ac: ${r.ac}, headway: ${r.headway}, first: ${r.first}, last: ${r.last}, km: ${r.km}, duration: ${r.duration}, est: true,\n    stops: [${stopList}] }`;
}).join(",\n");

fs.writeFileSync("js/data.js", body + routeLines + "\n];\n");

/* ---- report ---- */
const locatedCount = Object.keys(located).length;
const anchored = Object.keys(located).filter((n) => located[n].src === "anchor").length;
console.log("\nroutes emitted:", outRoutes.length);
console.log("distinct stops:", allStops.length);
console.log("stops plotted:", locatedCount,
  `(${Math.round((locatedCount / allStops.length) * 100)}%)`,
  "| hand-anchored:", anchored, "| geocoded+checked:", locatedCount - anchored);
console.log("spelling variants merged:", rename.size);
const byType = {};
outRoutes.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
console.log("by type:", JSON.stringify(byType));
const bySrc = {};
outRoutes.forEach((r) => { bySrc[r.src] = (bySrc[r.src] || 0) + 1; });
console.log("by source:", JSON.stringify(bySrc));
console.log("areas:", Object.keys(STOP_AREAS).map((a) => a + "(" + STOP_AREAS[a].length + ")").join(", "));

const reasonTally = {};
rejected.forEach(([, why]) => { const k = why.split(" with ")[0]; reasonTally[k] = (reasonTally[k] || 0) + 1; });
console.log("geocode rejections:", JSON.stringify(reasonTally));

const plottable = outRoutes.map((r) => {
  const have = r.stops.filter((s) => located[s]).length;
  return { no: r.no, pct: have / r.stops.length, have, total: r.stops.length };
}).sort((a, b) => a.pct - b.pct);
const avg = plottable.reduce((a, p) => a + p.pct, 0) / plottable.length;
console.log("average route plottability:", Math.round(avg * 100) + "%");
console.log("least plottable:", plottable.slice(0, 5).map((p) => `${p.no} ${Math.round(p.pct * 100)}%`).join(", "));
["S3W", "C8", "EB-16", "AC-4B", "KB16", "12C"].forEach((n) => {
  const p = plottable.find((x) => x.no === n);
  if (p) console.log(`  ${n}: ${p.have}/${p.total} placed (${Math.round(p.pct * 100)}%)`);
});

/* The trip that started all this, resolved the way the app resolves it: a
   search for a locality also matches the stops inside it. */
const sectorV = outRoutes.filter((r) => {
  const hits = ["Thakurpukur", "Thakurpukur 3A", "Thakurpukur Bazar"];
  const area = STOP_AREAS["Salt Lake Sector V"] || ["Salt Lake Sector V"];
  return r.stops.some((s) => hits.includes(s)) && r.stops.some((s) => area.includes(s));
});
console.log("\nThakurpukur -> Sector V:",
  sectorV.map((r) => r.no + " (" + r.operator + ")").join(", ") || "none");
