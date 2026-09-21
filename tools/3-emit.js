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
   WHAT IS ABSENT
     - frequencies and departure times. Neither published list carries them and
       no authoritative timetable for these services exists, so nothing here
       pretends to know when a bus leaves.
   COORDINATES
     Anchored stops only, plus geocoded stops that survive the neighbour test
     and are not a generic match several other stops also claim.
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
  // Every gate of the airport is the same destination for a bus passenger, and
  // the published lists spell them six different ways ("Airport 3no", "Airport
  // Gate No. 2.5", "Airport Gate-1", "Airport domestic Terminus"). Collapsing
  // them means a search for the airport finds every bus that goes there; the
  // gate-level geocodes were junk anyway (one sat 3.5 km off).
  [/^Airport\b/i, ["Airport"]],
  [/^Newtown\b/i, ["New Town"]],
  [/^Sapoorji\b|^Shapoorji\b|^Sapurji\b|^Sapooji\b|^Shapooji\b/i, ["Sapoorji"]],
  [/^TATA Medical\b|^Tata Medical\b|^Tata Cancer\b|^Tata Memorial\b/i, ["Tata Medical Centre"]],
  [/^Behala 14\b/i, ["Behala 14 No"]],
  // "Chiria More" is on the Barrackpore stretch; the catalogue sometimes puts
  // the locality first, sometimes last, and shortens both halves
  [/^(Chiria More|Chiriamore) Barrackpore$/i, ["Barrackpore Chiria More"]],
  [/^Barrackpore Chiriamore$|^Barakpur Chiriamore$|^Barrackpur Chiria ?more$/i, ["Barrackpore Chiria More"]],
  [/^BKP Chiriamore$/i, ["Barrackpore Chiria More"]],
  // two published stops the source table glued into one string
  [/^Thakurpukur Bazar Thakurpukur 3A$/i, ["Thakurpukur Bazar", "Thakurpukur 3A"]],
  [/^Bhabani Bhawan Hazra$/i, ["Bhabani Bhawan", "Hazra"]],
  [/^Exide Rabindra Sadan$/i, ["Exide", "Rabindra Sadan"]],
  [/^Karunamoyee\.?\s+Unnayan Bhavan$/i, ["Karunamoyee", "Unnayan Bhavan"]],
  [/^SDFCollege More$/i, ["SDF", "College More"]],
  [/^More$/, []],
  [/^Sanpui Para$/i, ["Sapuipara"]],
  [/^Metro politon Hou\. Est$/i, ["Metropolitan"]],
  [/^22\.?\s*$/i, []],
];

/* Old spellings that these fixes renamed away, kept so the app can still
   resolve them. Populated by fixStops and the anchor renames below. */
const fixRenames = new Map();

function fixStops(seq) {
  const out = [];
  for (const raw of seq) {
    let placed = false;
    for (const [re, repl] of STOP_FIXES) {
      if (re.test(raw)) {
        // a one-for-one fix is a rename, so remember the old spelling
        if (repl.length === 1 && repl[0] !== raw) fixRenames.set(raw, repl[0]);
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
  if (canonical !== name) fixRenames.set(name, canonical);
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

/* Run the same fixes over every spelling any source used, including routes that
   lost the dedupe above. A dropped duplicate can hold the only copy of an old
   name ("BKP Chiriamore" exists nowhere else), and that spelling should still
   resolve in the app. fixStops records what it renamed into fixRenames. */
const everySpelling = new Set();
all.forEach((r) => r.stops.forEach((s) => everySpelling.add(s)));
everySpelling.forEach((s) => fixStops([s]));

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
const NOISE = /\b(station|stn|more|crossing|busstand|busterminus|terminus|stand|stop|halt|ps|thana|corner|number|no|nums|num|road|rd|street|st|avenue|ave|row|lane|ln)\b/g;
const coreKey = (name) =>
  keyOf(name)
    // "Behala 14 no", "Behala 14no", "Behala 14 number" -> "behala 14"
    .replace(/(\d)\s*no\b/g, "$1")
    .replace(/\bno\s*(?=\d)/g, "")
    .replace(/(\d)\s*(?:number|num|nums)\b/g, "$1")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();

/* Names that look alike but are genuinely different places. Kolkata has two
   Santoshpurs, two Bishnupurs and two Padmapukurs; "Amta" (Howrah) is not
   "Amtala" (South 24 Parganas); the Karunamoyee in Tollygunge is not the one in
   Salt Lake. Orthographic similarity alone must never join these. */
const NEVER_MERGE = [
  /\bamta\b.*\bamtala\b|\bamtala\b.*\bamta\b/,
  /^tollygunge karunamoyee$/i,
  /^karunamoyee$/i,
  /^salt lake$/i,
  /^salt lake sector/i,
  /^garia$/i,
  /^garia station$/i,
  /^new town$/i,
  /^new barrackpore$/i,
  /^barasat$/i,
  /^santoshpur$/i,
  /^bishnupur$/i,
  /^padmapukur$/i,
  /^mohanpur$/i,
  /^exide$/i,
  /^rabindra sadan$/i,
  /^hazra$/i,
  /^lansdowne$/i,
  /^chowrasta$/i,
  /^behala$/i,
  /^bally$/i,
  /^dum dum$/i,
  /^sinthee$/i,
];
const isProtected = (name) => NEVER_MERGE.some((re) => re.test(name));

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

/* ------------------------------------------------------------ */
/* 3b. the long tail: one place, two spellings                   */
/*     The stem pass above only catches names that differ by a   */
/*     noise word or a space. The published lists are free text, */
/*     so they also carry plain mis-spellings — "Bekbagan" vs    */
/*     "Beckbagan", "Belgacchia" vs "Belgachia", "Sakherbzar" vs */
/*     "Sakherbazar", "Baguihati" vs "Baguiati". Join those by   */
/*     edit distance, scaled to the length of the name so short  */
/*     names ("Amta" / "Amtala") are never at risk, and checked  */
/*     against the geocoder's own answer for both spellings so a */
/*     pair that is demonstrably kilometres apart stays split.    */
/* ------------------------------------------------------------ */
const flat = (s) => coreKey(s).replace(/ /g, "");

/* bounded Levenshtein: gives up as soon as it exceeds `max` */
function editDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

/* Is a cached coordinate actually evidence about this name?
   Photon answers a lot of these rural halts with whatever it has: "Hoglashi
   More" came back as a feature called "More", "Malncha" as "Ahindra Mancha",
   "Kaltala" as "Kalitala Road North". Those are not answers, they are noise,
   and treating them as evidence would let the fuzzy pass merge any two names
   at all. So a coordinate only counts when the feature it matched at least
   resembles the name we asked for. */
function geocodeTrust(name) {
  const c = coords[name];
  if (!c || !c.src) return false;
  const a = flat(name), b = flat(c.src);
  if (a.length < 4 || b.length < 4) return false;
  if (b.startsWith(a.slice(0, Math.min(5, a.length)))) return true;
  return editDistance(a, b, 3) <= 3;
}

/** a coordinate we are willing to reason from, for this spelling */
const trustedCoord = (n) => {
  if (located[n]) return located[n];
  return geocodeTrust(n) ? coords[n] : null;
};

const allNames = [...freq.keys()];
const byFirst = new Map();                       // first letter -> names
allNames.forEach((n) => {
  const f = flat(n)[0] || "";
  if (!byFirst.has(f)) byFirst.set(f, []);
  byFirst.get(f).push(n);
});

const digitsOf = (s) => (s.match(/\d+/g) || []).join("|");

/* A one-letter difference only counts as a mis-spelling when something other
   than the spelling agrees. Here that means a trustworthy coordinate on *both*
   sides, close together. It is deliberately strict: it is what keeps "Kantala"
   and "Kaltala" (two different villages, neither of which the geocoder could
   actually find) apart, and "Matia Bridge" from "Matla Bridge" (the Matla is a
   river 40 km away). A pair this pass declines to join stays as published,
   which is the safe direction to fail in. */
const fuzzyPairs = [];
for (const [, bucket] of byFirst) {
  for (let i = 0; i < bucket.length; i++) {
    const a = bucket[i];
    const fa = flat(a);
    if (fa.length < 6) continue;
    for (let j = i + 1; j < bucket.length; j++) {
      const b = bucket[j];
      const fb = flat(b);
      if (fa === fb) continue;                   // already joined by the stem pass
      const minLen = Math.min(fa.length, fb.length);
      const maxLen = Math.max(fa.length, fb.length);
      // one keystroke apart on a name of 7+ letters, two on a name of 12+
      let max = -1;
      if (minLen >= 12 && maxLen <= 20) max = 2;
      else if (minLen >= 7) max = 1;
      if (max < 0) continue;
      if (isProtected(a) || isProtected(b)) continue;
      // a different number is a different stop: "Saltlake 13no. Tank" is not
      // "Saltlake 4no. Tank", and "Park Circus 4 number" is not "Park Circus"
      if (digitsOf(a) !== digitsOf(b)) continue;
      const ca = trustedCoord(a), cb = trustedCoord(b);
      if (!ca || !cb) continue;
      if (haversine([ca.lat, ca.lng], [cb.lat, cb.lng]) > SYNONYM_MAX_KM) continue;
      const d = editDistance(fa, fb, max);
      if (d > max) continue;
      union(a, b);
      fuzzyPairs.push([a, b, d]);
    }
  }
}
if (fuzzyPairs.length) {
  console.log("fuzzy spelling merges:", fuzzyPairs.length);
  fuzzyPairs.forEach(([a, b, d]) => console.log(`    ${a}  ~  ${b}   (edit distance ${d})`));
  fs.writeFileSync(
    "tools/cache/fuzzy-report.txt",
    fuzzyPairs.map(([a, b, d]) => `${a}  ~  ${b}  (d=${d})`).sort().join("\n") + "\n"
  );
}

const groups = new Map();
for (const name of freq.keys()) {
  const root = find(name);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(name);
}

/* Which spelling survives a merge. A placed name beats an unplaced one, and
   among equals the published list's own conventions decide: "Behala 14 No" is
   the stop, "Behala 14no" and "behala 14" are the same place typed carelessly.
   Without this the winner was whichever spelling happened to be busiest, so the
   UI showed "Behala 14no" and "- Dakbanglow More". */
function displayScore(name) {
  let score = 0;
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (name === name.toUpperCase() && letters.length > 1) score -= 3;       // "SDF MORE"
  if (name === name.toLowerCase() && letters.length > 1) score -= 3;       // "behala 14"
  if (/^[^A-Za-z0-9]/.test(name)) score -= 2;                              // "- Dakbanglow More"
  if (/[.,)]\s*$/.test(name)) score -= 2;                                  // "Aturia Bazar.)"
  if (/\s{2,}/.test(name)) score -= 1;
  if (/[a-z][A-Z]/.test(name)) score -= 1;                                 // "DumDum", "SakherBazar"
  const words = name.split(/\s+/);
  const cased = words.filter((w) => /^[A-Z]/.test(w)).length;
  score += cased / words.length;                                           // title case is the house style
  return score;
}

const rename = new Map();   // variant -> primary
const mergedPairs = [];
for (const [, members] of groups) {
  if (members.length < 2) continue;
  const ranked = members.slice().sort((a, b) => {
    const la = located[a] ? 0 : 1, lb = located[b] ? 0 : 1;
    if (la !== lb) return la - lb;                       // prefer a placed name
    const sa = displayScore(a), sb = displayScore(b);
    if (sa !== sb) return sb - sa;                       // prefer a well-formed name
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
  fs.writeFileSync(
    "tools/cache/merge-report.txt",
    "variant -> surviving name (" + mergedPairs.length + ")\n" +
    mergedPairs.map(([v, p]) => v + "  ->  " + p).sort().join("\n") + "\n"
  );
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
}

/* Rebuild the vocabulary from the routes as they now stand. The rename pass
   leaves the old spellings behind in `freq` and `located`, and those stale keys
   used to be emitted into KOLKATA_STOPS — stops that no longer exist in
   BUS_STOPS, so nothing could search for them but the map still drew them. */
freq.clear();
routes.forEach((r) => new Set(r.stops).forEach((s) => freq.set(s, (freq.get(s) || 0) + 1)));

const surviving = new Set(freq.keys());
Object.keys(located).forEach((n) => { if (!surviving.has(n)) delete located[n]; });

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

/* A merged primary inherits the coordinate of the spelling that had one — but
   it has to earn it like any other. Copying it in blindly is what put Agarpara,
   Amta, Bagnan, Machhlandapur, Naihati and Uluberia all on the same point:
   the geocoder had answered "Naihati Station" with the city's central bus
   terminal, and the rename carried that answer straight into "Naihati". */
const inherited = new Map();   // primary -> { coord, from }
for (const [variant, primary] of rename) {
  if (located[primary] || inherited.has(primary)) continue;
  const c = coords[variant];
  if (c) inherited.set(primary, { coord: c, from: variant });
}

const candidateFor = (name) => {
  const own = coords[name];
  if (own) return own;
  const inh = inherited.get(name);
  return inh ? inh.coord : null;
};

/* One point, many unrelated names.
   Photon answers far too many of these names with whatever generic feature
   shares their last word: all 54 "… More" stops in the dataset came back as a
   feature literally called "More", every "… Bazar" as "Shobha Bazar", every
   "… Station" as "Kolkata Station Bus Terminal", every "… Bridge" as "Brace
   Bridge", every "… Chowmatha" as "Chowbagha Road". A point that a crowd of
   different stops all claim is not a location, it is the geocoder giving up,
   so none of those answers are plotted. A point only one stop claims is kept —
   that is how PG Hospital keeps SSKM, IIM Joka keeps IIM Calcutta, and DLF1
   keeps DLF, all of which are right. */
const claimCount = new Map();
for (const name of freq.keys()) {
  if (located[name]) continue;
  const cand = candidateFor(name);
  if (!cand) continue;
  const k = cand.lat.toFixed(4) + "," + cand.lng.toFixed(4);
  claimCount.set(k, (claimCount.get(k) || 0) + 1);
}

for (const name of freq.keys()) {
  if (located[name]) continue;

  const cand = candidateFor(name);
  if (!cand) { rejected.push([name, "not geocoded"]); continue; }

  const ck = cand.lat.toFixed(4) + "," + cand.lng.toFixed(4);
  const claimants = claimCount.get(ck) || 1;
  if (claimants > 1) {
    rejected.push([
      name,
      "coordinate is a generic match shared with " + (claimants - 1) +
        (claimants - 1 === 1 ? " other stop" : " other stops"),
    ]);
    continue;
  }

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
/* 4. categories, operators, route length                        */
/* ------------------------------------------------------------ */
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

  return {
    no: r.no,
    operator: operatorOf(r),
    type: typeOf(r),
    src: r.src,
    cat,
    ac: cat !== "nonac",
    km,
    duration,
    stops: r.stops,
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
    "Techno India", "Nabadiganta", "Nabadiganta More",
  ],
  "New Town": [
    "New Town", "Eco Space", "Narkel Bagan", "Unitech", "Home Town",
    "Aliah University", "Axis Mall", "Rabindra Tirtha", "DLF", "City Centre II",
    "Chinar Park", "Eco Park", "Hidco Bhavan", "Jatragachi", "Nabadiganta",
    "Infosys Hatishala", "Sapoorji", "Tata Medical Centre", "Mahishbathan",
  ],
  // Joka is the terminus WBTC names "Joka" but the catalogue spells out as
  // "Thakurpukur 3A", and the buses that get you there also call at the ESI
  // hospital, the IIM and Khalpole. Searching "Joka" has to find all of them,
  // otherwise a route like C8 (which lists Joka) and C37 (which lists only
  // "Thakurpukur 3A") look like different services.
  "Joka": [
    "Joka", "Thakurpukur 3A", "Thakurpukur Bazar", "IIM Joka", "Joka Khalpole",
    "IIMC Hospital",
  ],
  // the DH Road stops either side of Joka, so a search for the locality finds
  // the buses that call at the market, the cancer hospital or the bus stand
  "Thakurpukur": [
    "Thakurpukur", "Thakurpukur Bazar", "Thakurpukur 3A",
    "Thakurpukur cancer hospital",
  ],
};

const vocab = new Set();
routes.forEach((r) => r.stops.forEach((s) => vocab.add(s)));

const STOP_AREAS = {};
Object.entries(AREA_DEFS).forEach(([area, members]) => {
  if (!vocab.has(area)) return;                    // the area name must be a real stop
  const present = members.filter((m) => vocab.has(m));
  if (present.length >= 2) STOP_AREAS[area] = present;
});

/* ------------------------------------------------------------ */
/* 6. emit                                                       */
/* ------------------------------------------------------------ */
const allStops = [...vocab].sort((a, b) => a.localeCompare(b));

/* ------------------------------------------------------------
   STOP_ALIASES
     Spellings that are no longer stops of their own, mapped onto the
     name they were merged into. Stage 2 records every spelling a source
     actually used; this pass follows those through the merge above, so
     "Sec V" ends up pointing at "Salt Lake Sector V" and "Bekbagan" at
     "Beckbagan". The app consults this when a typed name misses the stop
     list, which is what keeps old spellings and abbreviations searchable
     after a merge has removed them from BUS_STOPS.
   ------------------------------------------------------------ */
let aliasSpellings = {};
try {
  aliasSpellings = JSON.parse(fs.readFileSync("tools/cache/alias-map.json", "utf8"));
} catch (e) {
  console.log("alias map missing — run tools/2-geocode.js first");
}

const knownStops = new Set(allStops);
const knownLower = new Set(allStops.map((s) => s.toLowerCase()));
const aliasOut = new Map();
const looseOut = new Map();       // punctuation/spaces stripped, collision-checked
const looseClash = new Set();
const addAlias = (typed, target) => {
  const k = String(typed).trim().toLowerCase();
  if (!k || !target || !knownStops.has(target)) return;
  if (k === target.toLowerCase()) return;     // same thing, nothing to redirect
  if (knownLower.has(k)) return;              // still a real stop, don't shadow it
  if (!aliasOut.has(k)) aliasOut.set(k, target);
  // "sec v" should also answer to "secv", "behala 14no" to "behala14no"
  const loose = k.replace(/[^a-z0-9]/g, "");
  if (!loose || knownLower.has(loose)) return;
  if (looseOut.has(loose) && looseOut.get(loose) !== target) looseClash.add(loose);
  else if (!looseOut.has(loose)) looseOut.set(loose, target);
};
Object.entries(aliasSpellings).forEach(([typed, canonical]) => {
  addAlias(typed, rename.get(canonical) || canonical);
});
rename.forEach((primary, variant) => addAlias(variant, primary));
/* names the stage-3 fixes and the anchor renames replaced — e.g. "BKP
   Chiriamore", "Tata Cancer", the old "Rajarhat New Town" */
fixRenames.forEach((fixed, raw) => addAlias(raw, rename.get(fixed) || fixed));

// a loose key that could mean two different stops is worse than no alias at all
looseClash.forEach((k) => looseOut.delete(k));
looseOut.forEach((target, k) => { if (!aliasOut.has(k)) aliasOut.set(k, target); });

const STOP_ALIASES = {};
[...aliasOut.keys()].sort().forEach((k) => { STOP_ALIASES[k] = aliasOut.get(k); });

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

   NO TIMETABLE
     Neither published list carries frequencies or departure times, and no
     authoritative timetable for these services exists, so this dataset holds
     no clock times at all. The app shows which buses connect two stops and how
     long the ride is; it does not claim to know when the next one leaves.

   COORDINATES
     Only stops we can vouch for are plotted (verified anchors, plus
     geocoded stops that pass a route-geometry check). A stop without a
     coordinate is still fully searchable, it just isn't plotted, so the
     map never invents a dot.

   STOP_AREAS
     A locality people search for by name ("Sector V") mapped to the
     stops inside it, so one bus that reaches any of them answers the
     search while the map still plots the exact stop.

   STOP_ALIASES
     Spellings that were merged away ("Sec V", "Bekbagan"), mapped onto
     the surviving name, so the old way of typing a stop still works.
   ============================================================ */

/* stop name -> [lat, lng] — verified positions only */
const KOLKATA_STOPS = {`;

const stopLines = Object.keys(located).sort((a, b) => a.localeCompare(b))
  .map((n) => `  ${JSON.stringify(n)}: [${located[n].lat}, ${located[n].lng}]`)
  .join(",\n");

const body = `${header}\n${stopLines}\n};\n
/* every stop that appears on a route, with or without coordinates */
const BUS_STOPS = ${JSON.stringify(allStops, null, 0)};

/* old / misspelled spellings -> the name they were merged into (lowercase keys) */
const STOP_ALIASES = ${JSON.stringify(STOP_ALIASES, null, 2)};

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
     km        derived route length
     duration  derived end-to-end run time in minutes
     stops     ordered stop names
   ------------------------------------------------------------ */
const BUS_ROUTES = [
`;

const routeLines = outRoutes.map((r) => {
  const stopList = r.stops.map((s) => JSON.stringify(s)).join(", ");
  const srcs = r.srcs && r.srcs.length > 1 ? `, srcs: ${JSON.stringify(r.srcs)}` : "";
  return `  { no: ${JSON.stringify(r.no)}, operator: ${JSON.stringify(r.operator)}, type: ${JSON.stringify(r.type)}, src: ${JSON.stringify(r.src)}${srcs}, cat: ${JSON.stringify(r.cat)}, ac: ${r.ac}, km: ${r.km}, duration: ${r.duration},\n    stops: [${stopList}] }`;
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
console.log("legacy spellings kept searchable:", Object.keys(STOP_ALIASES).length);
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
fs.writeFileSync(
  "tools/cache/geocode-rejections.txt",
  rejected.map(([n, why]) => n + "\t" + why).sort().join("\n") + "\n"
);

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
