/* ============================================================
   Stage 2 — canonicalise stop names and geocode them.

   Build BusBondhu's dataset from the OFFICIAL WBTC city bus
   route list (https://wbtconline.in/wbtc-city-bus-routes).

   Route numbers, origins, termini and stop sequences are real.
   WBTC's published list contains no frequencies and no departure
   times, so those are clearly-marked assumptions (see ASSUMPTIONS).
   Stop coordinates are geocoded from OpenStreetMap via Photon and
   filtered to a Kolkata-region bounding box; anything outside it or
   not found is simply left without coordinates (still searchable).
   ============================================================ */
const fs = require("fs");
const path = require("path");

const RAW = JSON.parse(fs.readFileSync("tools/cache/routes.raw.json", "utf8"));
const CACHE = "tools/cache/coords.json";

const keyOf = (n) =>
  n.toLowerCase().replace(/\bno\.?\b/g, "no").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------
   Canonical groups. Every listed variant resolves to the group's
   display name. Only genuine synonyms / spellings are merged;
   distinct localities stay distinct.
   ------------------------------------------------------------ */
const GROUPS = {
  // ---- central Kolkata ----
  "Esplanade": ["espl", "esplanade", "esplanade east", "esplanade west"],
  "BBD Bag": ["bbd bag", "bbdbag", "b b d bag", "b b d bagh", "bbd bagh"],
  "Howrah Station": ["howrah", "howrah stn", "howrah station"],
  "Howrah Bridge East": ["howrah bridge east", "howrah bridge"],
  "Howrah Maidan": ["howrah maidan"],
  "MG Road": ["mg road", "mg rd", "mgroad", "mgroad xing", "m g road"],
  "B B Ganguly St": ["bbganguly st", "b b ganguly st", "bb ganguly st"],
  "Park Street": ["park street", "park st", "parkstreet"],
  "Park Circus": ["park circus"],
  "Maidan Metro": ["maidan metro"],
  "Dalhousie": ["dalhousie"],
  "Burrabazar": ["barabazar", "burrabazar", "burra bazar"],
  "Sealdah": ["sealdah", "sealdha", "sealdh"],
  "Moulali": ["moulali", "moulali more"],
  "Subodh Mallick Square": ["subodh mallick square", "subod mallick squre", "s mullick sq", "s mallick square", "smullick sq", "subodh mullick square"],
  "College Street": ["college street", "college st"],
  "Rajabazar": ["rajabazar"],
  "Girish Park": ["girish park", "grish park"],
  "Manicktala": ["manicktala", "maniktala"],
  "Sovabazar": ["sovabazar"],
  "Shyambazar": ["shyambazar"],
  "Grey St": ["grey st", "gray st"],
  "Vivekananda Rd": ["vivekananda rd"],
  "Khanna": ["khanna"],
  "Chiria More": ["chiria more", "chiriamore"],
  "CR Avenue": ["cr avenue", "c r avenue", "cr avn xing"],
  "Colutola St": ["colutala st", "colutola st", "kalutala"],
  "Lal Bazar": ["lalbazar"],
  "Central": ["central", "central avenue", "central metro stn"],
  "Kankurgachi": ["kankurgachi", "kankugachi"],
  "Ultadanga": ["ultadanga", "ultadanga 15 nobus stand"],
  "Manicktala PS": ["manicktala ps"],
  "Belgachia": ["belgachia"],
  "Beliaghata": ["beliaghata", "beliaghata xing", "beliaghata main road", "beliaghata con"],
  "Rashmoni Bazar": ["rashmoni bazar"],
  "Cannel Bridge": ["cannel bridge"],
  "Beliaghata Xing": ["beliaghata xing"],
  "Phool Bagan": ["phoolbagan", "phool bagan"],
  "Kadapara": ["kadapara"],

  // ---- north / airport corridor ----
  "Dum Dum Station": ["dum dum stn", "dum dum station"],
  "Nager Bazar": ["nager bazar"],
  "Michael Nagar": ["mickel nagar", "michael nagar"],
  "Birati": ["birati", "birati more"],
  "Bankra More": ["bankra more"],
  "Airport": ["airport", "air port", "airpport", "airport gate no", "airport gate no 1", "airport gate no1", "airport gate 1", "airport 1 no gate", "airport 1 no", "airport 3 no gate", "airport 3 no gate"],
  "Kaikhali": ["kaikhali", "koikhali"],
  "Baguiati": ["baguihati", "baguiati"],
  "Kestopur": ["kestopur"],
  "Tegharia": ["tegharia"],
  "Chinar Park": ["chinar park", "chiner park"],
  "Lake Town": ["laketown", "lake town"],
  "Bangur": ["bangur"],
  "Haldiram": ["haldiram"],
  "Dunlop": ["dunlop", "dunlop more", "dunlop bridge"],
  "Belghoria": ["belghoria"],
  "Belghoria Exp Way": ["belghoria exp way"],
  "Nimta": ["nimta"],
  "Durganagar": ["durganagar"],
  "Dakshineswar": ["dakshineswar", "dakhineswar"],
  "Bally Halt": ["ballyhalt", "balihalt", "bali halt", "bally halt"],
  "Bally": ["bally", "bally bazar"],
  "Belur Math": ["belur math", "belurmath"],
  "Titagarh": ["titagarh", "titagarh ps"],
  "Talpukur": ["talpukur"],
  "Khardah": ["khardha", "khardah"],
  "Panihati": ["panihati"],
  "Kamarhati": ["kamarhati"],
  "Rathtala": ["rathtala", "rathtala more"],
  "Sodepur": ["sodpur", "sodepur", "sodepur girja"],
  "Barrackpore": ["barrackpore", "barrackpur", "barrackpur court", "barrackpore court"],
  "Nilgunge": ["nilgunge depot", "nilgunge bazar", "nilgunge", "neilgunj"],
  "Mohanpur": ["mohanpur"],
  "Lalkuthi": ["lalkuthi"],
  "Sukchar Monument": ["sukchar manument", "sukchar monument"],
  "Bonhooghly": ["bonhooghly"],
  "Tobin Road": ["tobin rd", "tobin road"],
  "Sinthee More": ["sinthi more", "sinthimore"],
  "Ariadaha": ["ariadaha"],
  "Rajchandrapur": ["rajchandrapur"],
  "Madhyamgram": ["madhyamgram", "madhyamgram chowrasta xing", "madhyamgram chowmatha"],
  "Doltala": ["doltala", "doltola"],
  "BT College": ["bt college", "b t college", "new barrackpur bt college"],
  "Hridaypur": ["hridaypur"],
  "Dackbanglow More": ["dackbanglow more", "dakbunglow more", "dakbungalow more", "dackbalglow more"],
  "Barasat": ["barasat"],
  "Champadali More": ["champadali more"],
  "Ashoknagar": ["ashoknagar"],
  "Guma": ["guma"],
  "Bira": ["bira"],
  "Duttapukur": ["duttapukur"],
  "Habra": ["habra"],
  "Nilganj Bazar": ["nilgunge bazar"],
  "Rajballavpara": ["rajballavpara"],
  "Ganganagar": ["ganganagar"],

  // ---- Salt Lake / New Town ----
  "Science City": ["science city", "sc city", "scity", "s c city"],
  "Chingrighata": ["chingrighata", "chingrihata", "chingri ghata"],
  "Nicco Park": ["nicco park"],
  "Sukanta Nagar": ["sukanta nagar"],
  "College More": ["college more"],
  "SDF": ["sdf", "sdf more"],
  "Technopolis": ["technopolis", "technopolish", "techonopolis", "technopolis new town"],
  "New Town": ["new town", "newtown", "new town bus stand", "new town bus terminus", "new town central stand"],
  "Narkel Bagan": ["narkel bagan", "narkelbagan", "narkelbagn"],
  "Eco Park": ["eco park"],
  // Amity University sits inside Ecospace, and the catalogue names the stop
  // after the university while WBTC names it after the tech park
  "Eco Space": ["eco space", "ecospace", "ecispace", "amity university", "amity university ecospace", "amity"],
  // WBTC calls this terminus "Joka"; the catalogue spells it out
  "Thakurpukur 3A": ["thakurpukur 3a", "thakurpukur 3a bus stand", "3a bus stand", "thakurpukur 3a bus stand joka"],
  "Unitech": ["unitech", "unitech gate 2"],
  "Home Town": ["home town", "hometown"],
  "Aliah University": ["aliah", "aliah university"],
  "Rabindra Tirtha": ["rabindra tirtha"],
  "Nababpur": ["nababpur"],
  "DLF": ["dlf 1", "dlf 2", "dlf"],
  "Axis Mall": ["axis mall"],
  "Karunamoyee": ["karunamoyee", "karunamayee", "kanunamoyee"],
  "Central Park": ["central park"],
  "City Centre II": ["city centre ii"],
  "City Centre I": ["city centre i"],
  "KBKC More": ["kbkc more"],
  "Metropolitan": ["metropolitan"],
  // "Sec5"/"Sector 5" is the literal Sector V stop used by C8 & friends.
  // "Salt Lake" on its own (S-16's terminus) is the Karunamoyee-side hub.
  "Salt Lake Sector V": ["sec5", "sector 5", "salt lake sector v", "sector v", "salt lake sector 5"],
  "Salt Lake": ["salt lake"],
  "HUDCO": ["hudco"],
  "PNB": ["pnb"],
  "C A Island": ["c a island", "ca island"],
  "Labony": ["labony"],
  "Seva Hospital": ["seva hospital"],
  "Baisakhi Bhavan": ["baisaki bhavan", "baisakhi bhavan"],
  "Wipro": ["wipro", "wipro more"],
  "Swastha Bhavan": ["swastha bhavan", "swastha bhawan", "sasthyabhavan"],
  "Unnayan Bhavan": ["unnayan bhawan"],
  "Purta Bhavan": ["purta bhawan"],
  "SLD Gate": ["sld gate", "sl d gate"],
  "Weble House": ["weble house"],
  "4 No Tank": ["4 no tank", "4no bridge"],
  "Ramkrishna Mission": ["ramkrishna mission"],

  // ---- south Kolkata ----
  "Gariahat": ["gariahat"],
  "Ballygunge": ["ballygunge", "ballygunge station", "ballygunge stn"],
  "Deshapriya Park": ["deshapriya park"],
  "Rashbehari": ["rashbehari", "rashbihari", "rashbehari ave", "rashbehari xing", "rashbehari avenue xing", "rashbehari avn"],
  "RB Avenue": ["rb avenue", "rbave", "r b ave", "r b avenue"],
  "Hazra": ["hazra", "hazra rd"],
  "Bhowanipore": ["bhowanipore"],
  "Elgin": ["elgin", "elgin rd"],
  "Exide": ["exide"],
  "Topsia More": ["topsia more", "topsia road xing", "topsia rd xing"],
  "Kasba PS": ["kasba ps", "kasba"],
  "Mominpur": ["mominpur", "mominpore", "mominpor", "momonpore", "mouminpur"],
  "Khidderpore": ["khidderpore", "khidirpore", "khiddirpor", "khiderpur", "kidderpore", "khidirpur", "khiddirpore", "khiderpore"],
  "Taratala": ["taratala", "taratala xing", "taratala more", "taratala depot", "taratala xing"],
  "Behala Chowrasta": ["behala chowrasta", "behala chowrastha", "behala chorasta", "chowrastha"],
  "Behala": ["behala"],
  "Behala Tram Depot": ["behala tram depot"],
  "Behala PS": ["behala ps"],
  "Behala 14 No": ["behala 14 no"],
  "Behala Airport": ["behala airport"],
  "Manton": ["menton", "manton"],
  "James Long Sarani": ["james long sarani", "james long sarani crossing"],
  "Sarsuna": ["sarsuna"],
  "Bakultala": ["bakultala"],
  "Sakuntala Park": ["sakuntala park"],
  "Raidighi": ["raidighi"],
  "Nutan Para": ["nutan para"],
  "Parnasree": ["parnasree", "parnashri", "parnasree"],
  "New Alipore": ["new alipore", "new alipore petrol pump"],
  "Chetla": ["chetla"],
  "Alipore Zoo": ["alipore zoo", "zoo"],
  "Majerhat": ["majerhat", "majherhat"],
  "Watgangemore": ["watgangemore"],
  "Lohapoll": ["lohapoll"],
  "Middle Rd": ["middle rd"],
  "Thakurpukur": ["thakurpukur", "thakurpukur 3a bus stand", "thakurpukur 3a", "thakurpukur bazar", "thakurpukur 3a stand"],
  "Silpara": ["silpara", "shilpara"],
  "Sakherbazar": ["sakherbazar", "sakher bazar"],
  "Kabardanga": ["kabardanga"],
  "Haridevpur": ["haridevpur", "haridebpur"],
  "Siriti More": ["siriti more", "siriti more"],
  "Ramkrishna Ashram": ["ramkrishna ashram", "ramkrishna ashram"],
  "Joka": ["joka", "joka esi hospital", "joka tram depot", "joka bridge"],
  "Pailan": ["pailan"],
  "Amtala": ["amtala"],
  "Bishnupur": ["bishnupur"],
  "Khariberia": ["khariberia", "kheriberia"],
  "Budge Budge": ["budge budge", "budge budge hospital", "budge budge bridge"],
  "Achipur": ["achipur"],
  "Nungi": ["nungi", "nungimore"],
  "Eden City": ["eden city", "eden city gate"],
  "Dakghar": ["dakghar"],
  "Mollar Gate": ["mollar gate", "mollar gate"],
  "Jingira Bazar": ["jingirabazar", "jingira bazar"],
  "Batamore": ["batamore"],
  "Metiabruz": ["metiabruj", "metiabruz"],
  "Garden Reach": ["garden reach"],
  "Ramnagar": ["ramnagar", "ramnagar more"],
  "Fatehpur": ["fatehpur"],
  "BNR More": ["bnr more"],
  "Babubazar": ["babubazar"],
  "Santragachi": ["santragachi"],
  "Belepole": ["belepole", "belepore"],
  "Toll Tax": ["toll tax"],
  "Carry Road": ["carryroad", "carry road"],
  "Toll Plaza": ["toll plaza"],
  "Vidyasagar Setu": ["vidyasagar setu"],
  "Nabanna": ["nabanna"],
  "Mandirtala": ["mandirtala", "madirtala"],
  "Hastings": ["hastings", "hestings"],
  "Watgunge": ["watgunge"],
  "Kona Expressway": ["kona express", "kona expressway"],
  "Salap": ["salap", "salap more"],
  "D.H. Road": ["d h road", "dh road"],
  "Tollygunge": ["tollygunge", "tollygunge tram depot", "tollygunge metro"],
  "Tollygunge Phari": ["tollygunge phari"],
  "Kundghat": ["kundghat"],
  "Chandi Ghosh": ["chandi ghosh"],
  "Regent Park": ["regent park"],
  "Naktala": ["naktala"],
  "Ranikuthi": ["ranikuthi", "ranikuthi"],
  "Ganguli Bagan": ["ganguli bagan"],
  "Baghajatin": ["baghajatin", "baghajatin"],
  "Jadavpur": ["jadavpur", "jadavpore", "jadavpur ps"],
  "Dhakuria": ["dhakuria"],
  "Selimpur": ["salimpur", "selimpur"],
  "Golpark": ["golpark"],
  "Lake Gardens": ["lake gardens"],
  "Santoshpur": ["santoshpur", "santoshpur stn"],
  "Patuli": ["patuli", "patuli more", "patuli ps"],
  "Garia": ["garia"],
  "Narendrapur": ["narendrapur"],
  "Rajpur Bazar": ["rajpur bazar"],
  "Kamalgazi": ["kamalgazi", "kamalgazi more"],
  "Dhalai Bridge": ["dhalai bridge"],
  "Harinavi": ["harinavi"],
  "Baruipur": ["baruipur", "baruipur new terminus", "baruipur hospital", "baruipur station"],
  "Shibanipith": ["shibanipit baruipur", "shibanipith", "shibanipit"],
  "Padmapukur": ["padmapukur"],
  "Khasmallick": ["khasmallick"],
  "Malancha Bazar": ["malancha bazar"],
  "Mission Gate": ["mission gate"],
  "Peerless Hospital": ["peerless", "peerless hospital"],
  "Ajoy Nagar": ["ajoynagar", "ajaynagar", "ajay nagar"],
  "Kalikapur": ["kalikapur"],
  "Ruby Hospital": ["ruby", "rubi", "ruby hospital", "ruby xing"],
  "VIP Bazar": ["vip bazar", "v i p bazar"],
  "Uttar Panchannagram": ["uttar panchannagram", "panchanan gram"],
  "Bantala": ["bantala", "bantala bazar"],
  "Katatala": ["katatala", "kantatala"],
  "Karidanga": ["karidanga", "karaidanga"],
  "Bhojerhat": ["bhojerhat"],
  "Paglahat": ["paglahat", "paglarhat"],
  "Baralighat": ["baralighat"],
  "Ghatakpukur": ["ghatakpukur", "ghatatkpukur"],
  "Chandipur": ["chandipur"],
  "Bhushighata": ["bhushighata"],
  "Bamanpukur": ["bamanpukur"],
  "Minakhan": ["minakhan"],
  "Joypur": ["joypur"],
  "Malancha": ["malancha"],
  "Chowbaga": ["chowbaga"],
  "Borali Ghat": ["borali ghat", "baralighat"],
  "Nalmuri": ["nalmuri"],
  "Leather Complex": ["leather complex"],
  "Garia Station": ["garia stn"],
  "Nayabad": ["nayabad", "nayabad stand"],
  "Panchasayar": ["panchasayar"],
  "Peerless": ["peerless"],
  "Dinobandhu Andrews College": ["dinobandhu andrews college"],
  "Arabinda Pally": ["arabinda pally"],
  "Sukanta Setu": ["sukanta setu"],
  "Bijan Setu": ["bijan setu"],
  "Panchanan Gram": ["panchanan gram"],
  "Hiland Park": ["hiland park"],
  "Mukundapur": ["mukundapur"],
  "Kalikapur": ["kalikapur"],
  "Anwar Shah Road": ["anwar shah road", "anwar shah rd"],
  "D P Sasmal Rd": ["d p sasmal rd", "dpsasmal rd"],
  "Jeevan Deep": ["jeevan deep"],
  "Wellington Square": ["welington sq", "wellington sq", "wellington square"],
  "Chittaranjan Hospital": ["chittaranjan hospital"],
  "Bowbazar": ["bowbazar"],
  "4 No Bridge": ["4no bridge", "4 no bridge"],
  "CIT Road": ["cit road", "c i t road xing"],
  "Ananda Palit": ["ananda palit"],
  "Shibtala Math": ["shibtala math"],
  "Taratala Depot": ["taratala depot"],

  // ---- far south / south 24 parganas ----
  "Sonarpur": ["sonarpur"],
  "Rajpur": ["rajpur"],
  "Baruipur Padmapukur": ["baruipur padmapukur"],
  "Budge Budge Bridge": ["budge budge bridge"],
  "Pujali": ["pujali"],
  "Charial": ["charial"],
  "Maheshtala": ["maheshtala"],
  "Batanagar": ["batanagar"],
  "Nangi": ["nangi"],
  "Akra": ["akra"],
  "Akra Rabindranagar": ["akra rabindranagar"],
  "Paharpur": ["paharpur"],
  "Sahapur": ["sahapur"],
  "Nangi": ["nangi"],
  "Ranabelia Ghat": ["ranabelia ghat"],
  "Suryapur": ["suryapur"],
  "Amratal": ["amratal"],
  "Magurkhali Bridge": ["magurkhali bridge"],
  "Dhamua": ["dhamua"],
  "Basundharia": ["basundharia"],
  "Tahelarampur Bazar": ["tahelarampur bazar"],
  "Rajarhat": ["rajarhat"],
  "Bhojerhat": ["bhojerhat"],
  "Sankrail": ["sankrail", "sankrail station", "sankrail bharat co op"],
  "Podra": ["podra"],
  "Champatala": ["champatala"],
  "Bakultala": ["bakultala"],
  "Danshekh Lane": ["danersekh lane", "d sekh lane", "d sekh lane"],
  "Domjur": ["domjur"],
  "Makardaha": ["makardaha"],
  "Jagatballavpur": ["jagatballavpur"],
  "Dilakhash": ["dilakhash"],
  "Bargachia": ["bargachia"],
  "Ichanagari": ["ichanagari"],
  "Rajapur": ["rajapur"],
  "Dakshinbari": ["dakshinbari"],
  "Kalitala Bazar": ["kalitala bazar"],
  "Bhattanagar": ["bhattanagar"],
  "Hanskhali": ["hanshkhali"],
  "Tikiapara": ["tikiapara"],
  "Telecom": ["telecom"],
  "Bally Ghat": ["bally ghat"],
  "Jagannathpur": ["jagannathpur"],
  "Barbaria": ["barbaria"],
  "Kokapur": ["kokapur"],
  "Rangapur": ["rangapur"],
  "Mathrangi": ["mathrangi"],
  "Chapuria": ["chapuria"],
  "Debpukur": ["debpukur"],
  "Wireless More": ["wireless more"],
  "Subhash Colony": ["subhash colony"],
  "Barrackpore Station": ["barrackpore station", "barrackpore stn"],
  "Kazibari": ["kazibari", "kazibari more"],
  "Barbaria": ["barbaria"],
  "Narayanpur More": ["narayanpur more"],
  "State University": ["w b state university barasat", "state university"],
  "Shibrampur": ["shibrampur"],
  "Sasthir More": ["sasthir more"],
  "Sonamukhi Bazar": ["sonamukhi bazar"],
  "Bagpota": ["bagpota"],
  "Kestor More": ["kestor more"],
  "Khudiram Park": ["khudiram park"],
  "Muchipara": ["muchipara xing"],
  "Panchanantala": ["panchanantala"],
  "Roy Bahadur Road": ["roy bahadur road"],
  "Burashibtala": ["burashibtala main road"],
  "Naihati": ["naihati bus terminus"],
  "Bhatpara": ["bhatpara"],
  "Shyamnagar": ["shyamnagar"],
  "Hela Battala": ["hela battala"],
  "Rampur": ["rampur"],
  "Jalkol": ["jalkol"],
  "Sabeda Bagan": ["sabeda bagan"],
  "Alambazar": ["alambazar"],
  "Bag Bazar": ["bag bazar", "bagbazar"],
  "Baranagar": ["baranagar bazar", "baranagar"],
  "Bibir Bazar": ["bibir bazar"],
  "Cossipore": ["cossipur", "cossipore"],
  "Nimtala": ["nimtala ghat st", "nimtala"],
  "B K Paul Ave": ["b k paul ave"],
  "MG Road Jn": ["m g road jn"],
  "Chitpur": ["chitpur crossing"],
  "Mudiali": ["muduali"],
  "Kachhi Sarab": ["kachhi sarab"],
  "Babughat": ["babughat"],
  "Princep Ghat": ["princep ghat"],
  "Strand Road": ["stand road", "strand road"],
  "GPO": ["gpo"],
  "Kolkata Station": ["kolkata stn"],
  "R G Kar Hospital": ["r g kar hospital"],
  "Sealdah Canal Bridge": ["sealdah canal bridge"],
  "Bank of India": ["bank of india"],
  "S N Banerjee Rd": ["snbanarjee rd", "s n banerjee rd"],
  "Marine College": ["marine college"],
  "Mahabirtala": ["mahabirtala"],
  "I P A Sha Rd": ["i p a sha rd"],
  "Kudghat": ["kudghat"],
  "T T Depot": ["t t depot"],
  "Chandi Ghosh Rd": ["chandi ghosh rd"],
  "Dilkhusa": ["dilkhusa"],
};

const VARIANT = new Map();
Object.entries(GROUPS).forEach(([canonical, variants]) => {
  variants.forEach((v) => VARIANT.set(keyOf(v), canonical));
});

const MISSING_DISPLAY = new Map(); // key -> raw display name (used when no alias matched)

function canonicalise(raw) {
  const k = keyOf(raw);
  if (!k) return null;
  if (VARIANT.has(k)) return VARIANT.get(k);
  if (MISSING_DISPLAY.has(k)) return MISSING_DISPLAY.get(k);
  // Title-case unknown names without destroying acronyms / route-ish tokens
  const pretty = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([A-Z]{2,})\b/g, (m) => m) // keep acronyms
    .replace(/^./, (c) => c.toUpperCase());
  MISSING_DISPLAY.set(k, pretty);
  return pretty;
}

/* ---- clean routes, from BOTH sources ----
   WBTC's published list and kolbusopedia's catalogue are canonicalised by
   the same alias table so a stop is one stop no matter which list it came
   from. Each source keeps its own file so stage 3 can merge and dedupe. */
const SOURCES = [
  { file: "tools/cache/routes.raw.json", source: "wbtc", defaultSection: "WBTC city routes" },
  { file: "tools/cache/routes.extra.json", source: "kolbusopedia", defaultSection: "Private / other operators" },
  { file: "tools/manual-routes.json", source: "manual", defaultSection: "Relaunched / newer services" },
];

function canonicalSeq(stops) {
  const seq = [];
  stops.forEach((s) => {
    const c = canonicalise(s);
    if (!c) return;
    if (seq[seq.length - 1] === c) return;
    seq.push(c);
  });
  return seq;
}

function normaliseNo(no) {
  let n = String(no).replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
  n = n.replace(/\(IT\.?\s*Spl\.?\)/i, "(IT Spl)").replace(/\s*Spl\.?$/i, " Spl");
  return n;
}

const freq = new Map();          // canonical stop -> how many routes serve it
const perSource = {};

SOURCES.forEach(({ file, source, defaultSection }) => {
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error("!! cannot read " + file + " — run its extractor first");
    return;
  }

  const out = [];
  raw.forEach((r) => {
    const seq = canonicalSeq(r.stops);
    if (seq.length < 2) return;
    seq.forEach((s) => freq.set(s, (freq.get(s) || 0) + 1));
    out.push({
      no: normaliseNo(r.no),
      stops: seq,
      section: r.section || defaultSection,
      list: r.list || "govt",
      source,
    });
  });

  fs.writeFileSync(`tools/cache/routes.canonical.${source}.json`, JSON.stringify(out, null, 1));
  perSource[source] = out;
  console.log(source.padEnd(12), "routes:", out.length);
});

const stopSet = new Set(freq.keys());
const routes = perSource.wbtc || [];
console.log("canonical stops across both sources:", stopSet.size);

const unaliased = [...MISSING_DISPLAY.keys()].length;
console.log("stop names not covered by the alias table:", unaliased);

/* ------------------------------------------------------------
   Geocode (cached). Photon, biased hard to central Kolkata.
   ------------------------------------------------------------ */
const BBOX = { minLat: 22.2, maxLat: 23.05, minLng: 87.95, maxLng: 88.75 };
let cache = {};
if (fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "BusBondhu-data-build/1.0 (static site; one-off offline geocoding)";

async function photon(name, extra) {
  const q = encodeURIComponent(extra ? `${name} ${extra}` : name);
  const url = `https://photon.komoot.io/api/?q=${q}&limit=5&lang=en&lat=22.5726&lon=88.3639`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const j = await res.json();
  for (const f of j.features || []) {
    const [lng, lat] = f.geometry.coordinates;
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) continue;
    const p = f.properties || {};
    const ctx = [p.name, p.street, p.district, p.city, p.county, p.state].filter(Boolean).join(" ").toLowerCase();
    if (!/kolkata|howrah|bidhannagar|barasat|barrackpore|south 24|north 24|hooghly|salt lake|rajarhat|new town|behala|thakurpukur/.test(ctx)) continue;
    return { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), src: p.name || name };
  }
  return null;
}

(async () => {
  /* Coordinates are only ever *accepted* when stage 3 can corroborate them
     (see the anchor + route-geometry checks there), so there is no point
     geocoding the long tail of village halts: fetch the busiest stops
     first and stop at GEOCODE_BUDGET new ones per run. */
  // how many unseen stops to fetch per run; set GEOCODE_BUDGET=0 to rebuild
  // entirely from the cache (fast, and no network)
  const GEOCODE_BUDGET = Number(process.env.GEOCODE_BUDGET || 700);
  const todo = [...stopSet]
    .filter((s) => !(s in cache))
    .sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || a.localeCompare(b))
    .slice(0, GEOCODE_BUDGET);
  console.log("to geocode:", todo.length, "| cached:", Object.keys(cache).length);

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    let hit = null;
    try {
      hit = await photon(name);
      if (!hit) hit = await photon(name, "Kolkata");
    } catch (e) {
      hit = null;
    }
    cache[name] = hit;
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`  ${i + 1}/${todo.length}  (located so far: ${Object.values(cache).filter(Boolean).length})`);
    }
    await sleep(name.length > 22 ? 220 : 120);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));

  const located = Object.entries(cache).filter(([, v]) => v);
  const missing = Object.entries(cache).filter(([, v]) => !v).map(([k]) => k);
  console.log("located:", located.length, "| unlocated:", missing.length);
  fs.writeFileSync("tools/cache/unlocated.txt", missing.join("\n"));
})();
