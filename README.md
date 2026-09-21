# 🚌 BusBondhu — Kolkata's Bus Companion

> **বাসবন্ধু** — find any bus across Kolkata, with route maps and estimated ride times.

A single-page, dependency-light website that helps you figure out **which buses run between two Kolkata
stops**, sorted by the shortest ride, with a route map for every service.

Route numbers, origins, termini and stop sequences come from **two published lists** — WBTC's official
city bus route table and Kolkata Bus-O-Pedia's catalogue of **private, minibus, C / D / E, K / KB,
M / MM / MN, SD / DN and STA services** — for **537 real routes**, from `S-3W`, `C8` and `EB-16` to
`12C`, `KB16`, `DN-8` and the numberless rural STA runs. It is a **100% static site**, so it hosts
beautifully (and free) on **GitHub Pages**.

> ### ⚠️ What is real, and what is an estimate
>
> | | |
> |---|---|
> | **Real** | route numbers, origins, termini, stop sequences — each route says which list it came from (`src`) |
> | **Derived** | route length and end-to-end run time, computed from the mapped stops |
> | **Estimated** | the ride time for *your* stretch, apportioned along the route |
> | **Absent** | frequencies and departure times — **no timetable is shown, because none is published** |
>
> Neither list carries timetables, and no authoritative Kolkata timetable exists for these services, so
> this site deliberately shows **no clock times at all**. It answers "which buses run my stretch and how
> long is the ride", never "when does the next one leave". Stop positions are approximate, and most
> stops have no position at all (see below). **For anything that matters, check with the operator.**
>
> The catalogue is community-maintained, not official: if a bus number matters to you, confirm it
> before you travel. Every route is attributed, so you can check any row against its source URL.

---

## ✨ Features

| # | Feature |
|---|---------|
| 1 | Cool, Kolkata-flavoured brand — **BusBondhu** with a live Kolkata clock |
| 2 | **2 inputs**: source and destination, with a swap button |
| 3 | Type-ahead over every stop either published list names, plus the localities and the old spellings — a **touch-friendly list**, not the native `<datalist>`, which phones ignore |
| 4 | **Search** shows every bus that runs your stretch — government, private, minibus and STA |
| 5 | Click any bus → **route map**, total **km** and estimated **ride time** |
| 6 | Every unique bus shown in its **own row**, bus number big & legible |
| 7 | Each row shows how much of the route you actually ride: **stops, km, minutes** |
| 8 | Results sorted by the **shortest ride**, then distance, then stop count |
| 9 | **Glassmorphism**, **neomorphism** and buttery **transitions** everywhere |
| 10 | “Buy me a coffee” section with **Instagram** + **WhatsApp** buttons |
| 11 | Footer with **All rights reserved** |
| 12 | Routes run **both ways** — a bus that lists Barasat last still takes you Barasat → Esplanade |
| 13 | No direct bus? We suggest the **nearest connecting stop**, or a **one-change journey** |
| 14 | **Shareable links** — every search is written to the URL (`?from=…&to=…`), back/forward work |
| 15 | **No API keys anywhere**, and Leaflet is **vendored locally** so the map never depends on a CDN |
| 16 | **537 real routes** with their published stop sequences, from WBTC + Kolkata Bus-O-Pedia |
| 17 | Search by **locality** — “Sector V” finds buses that stop at SDF, College More or Technopolis |
| 18 | Merged-away spellings still work — typing “Sec V”, “Bekbagan” or “BKP Chiriamore” resolves to the surviving stop and says so |
| 19 | **No fake timings.** Neither source publishes a timetable, so no clock times are shown |

Extras: filters (All / AC / Electric / Non-AC) with a live “showing X of Y” count, swap button that
re-runs the search, quick-pick routes, keyboard-accessible rows, a proper focus-trapped dialog with
Escape support, hoverable stop points, toast notifications, and a fully responsive layout.

---

## 📁 Project structure

```
.
├── index.html         # markup: hero, search card, results, support, footer, map modal
├── 404.html           # themed not-found page (GitHub Pages serves this automatically)
├── css/
│   └── styles.css     # glassmorphism + neomorphism + animations + responsive rules
├── js/
│   ├── data.js        # GENERATED: 537 routes + verified stop coordinates + localities + aliases
│   └── app.js         # route matching, sorting, filters, transfer plans, Leaflet map
├── vendor/
│   └── leaflet/       # Leaflet 1.9.4 (js + css + images), served from your own domain
├── tools/             # data pipeline that generates js/data.js (see tools/README.md)
├── .nojekyll          # tell GitHub Pages to serve files as-is, no Jekyll pass
├── robots.txt
└── README.md
```

No build step, no framework, no bundler, no dependencies to install. Just static files.

---

## 🚀 Run it locally

Because everything is static, you can either:

**Option A — just open it**

Double-click `index.html`. (Everything works except that some browsers restrict `file://` fetches;
this project doesn't fetch anything, so it's fine.)

**Option B — serve it (recommended)**

```bash
# Python 3
python -m http.server 5500

# or Node
npx serve .
```

Then open <http://localhost:5500>.

---

## 🌐 Host it for free on GitHub Pages

1. **Create a GitHub repository** (e.g. `busbondhu`) and push this folder to it:

   ```bash
   git init
   git add .
   git commit -m "BusBondhu: Kolkata bus companion"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. In the repo, go to **Settings → Pages**.

3. Under **Build and deployment → Source**, choose **Deploy from a branch**.

4. Set **Branch** to `main` and the folder to `/ (root)`, then **Save**.

5. Wait ~1 minute. Your site goes live at:

   ```
   https://<your-username>.github.io/<your-repo>/
   ```

> Tip: Because all asset paths are **relative** (`css/styles.css`, `js/app.js`, `vendor/leaflet/…`), the
> site works both at the domain root and under a `/repo-name/` sub-path with no changes.
>
> Nothing else to configure: there is no build step, no API key and no environment variable. The
> bundled `.nojekyll` tells Pages to serve the files as-is, and `404.html` is picked up automatically as
> the not-found page. To preview the exact production build locally, run `python -m http.server` and
> open the site from `http://localhost:5500/` rather than opening the file directly — that is what Pages
> does, and it keeps things like the shareable `?from=…` URLs working.

---

## 🗺️ How the bus matching works

* Each route in `js/data.js` has an ordered list of `stops` as published, plus a derived total `km`
  and `duration`. There is **no** `headway` and no `first`/`last`: neither published list carries a
  timetable and no authoritative one exists, so the dataset holds no clock times at all.
* A name you type is resolved in three steps — the stop list, then `STOP_ALIASES` (old and misspelled
  spellings that were merged away), then the same again with punctuation squeezed out. Every spelling
  the alias table *declares* is in there, not just the ones a source happened to use, so `salt lake
  sector 5`, `saltlake sector v` and `p t s` all land on the right stop even though no published list
  ever wrote them that way. When an alias is used the app says so in a toast, so a substitution is
  never silent.
* Searching a **locality** (`STOP_AREAS`) matches every route stopping anywhere inside it, using the
  exact member stop for the segment maths and the map. A locality that is *also* a real stop — “Joka”,
  “Thakurpukur”, “New Town”, “Salt Lake Sector V” — keeps the routes that serve it by name **and**
  gains the routes that only reach its other members.
* Routes are **bidirectional**. A route is stored once, in one direction, and the app also serves it
  in reverse — a bus that lists Barasat last still runs Barasat → Esplanade.
* For a search, the app finds the **segment** between your source and destination on each route.
* Rows are **sorted by the shortest ride** (`duration × fraction`), then by distance, then by stop
  count, then by bus number — so the quickest hop floats to the top.

Travel time and distance for a segment are estimated proportionally along the route
(`duration × fraction`, `km × fraction`). Nothing claims to know when a bus leaves.

### The stop picker

The two fields used to be `<input list="…">` + `<datalist>`, which works on a desktop browser and
does **nothing** on a phone: iOS Safari and several Android browsers either ignore the element or
open a sheet that cannot be filtered. The list is now built in the DOM, so every browser gets the
same one. The touch details that matter:

* rows are **46px** tall — the smallest comfortable tap target — and the list scrolls
  (`overscroll-behavior: contain`, so it doesn't drag the page with it)
* selection listens on **`pointerdown`**, because a tap blurs the field before a `click` can land;
  a `click` handler is kept as a fallback, and choosing the same row twice is harmless
* the list **flips above** the field when the keyboard leaves no room below, measured against
  `visualViewport` rather than `innerHeight` (only the former shrinks with the keyboard)
* it deliberately does **not** close on scroll — it is anchored to the field, and closing on scroll
  would break the phone case, where focusing a field makes the browser scroll it above the keyboard
* the inputs are **16px**, because anything smaller makes iOS zoom the page on focus
* an empty field shows the **busiest stops**, so tapping it visibly does something
* typing a spelling that was merged away (`sec v`) offers the surviving stop as its own row, and
  Arrow keys / Enter / Escape work as a normal combobox (`role="combobox"` + `aria-activedescendant`)
* the open field's **wrapper** carries a `z-index`, not just the list. `.input-wrap:focus-within`
  lifts itself by 1px with a `transform`, and a transform opens a stacking context — which would
  trap the list's own `z-index` inside that wrapper and let the *next* field paint straight across
  the middle of the dropdown. On a phone that sliced the list into three stripes, with the middle
  rows un-tappable.
* the source note in the card header wraps below 520px instead of staying a `nowrap` pill, which
  was wider than the screen and got clipped mid-word

### When nothing runs direct

Kolkata routes funnel through a handful of hubs, so a cross-city pair often needs one change. The
empty state handles that in two steps, and both go through the **same** `computeRows()` engine as a
real search, so nothing shown can fail to deliver when you act on it:

1. **Nearest stops that do connect** — up to four stops within 4 km that make the trip work if you
   board or alight there instead. Clicking a chip re-runs the search from that stop.
2. **Or change buses once along the way** — up to two one-change plans, naming the change-over stop
   and each leg's ride time plus a door-to-door total.

If neither exists, the app says so plainly instead of pretending.

---

## 🗺️ Map & tiles (no API key required)

The route map needs **no signup and no key**. It tries these key-free basemaps in order and falls
through automatically if one fails to serve tiles:

| # | Provider | Notes |
|---|----------|-------|
| 1 | **OpenStreetMap** raster tiles | inverted with a CSS filter over the tile pane only, so the UI stays dark while route lines keep their real colours |
| 2 | **Esri** World Dark Gray Canvas | already dark, used if OSM tiles error out |

> **Why not CARTO?** Earlier versions used CARTO’s `dark_all` basemap. CARTO now answers every
> keyless tile request with an `API KEY REQUIRED` watermark image, which is exactly what made the
> route map look like an empty grey box. OSM + Esri need no key, so the map works for good.

Map tiles are a third-party service under their own terms (attribution is rendered in the map corner).
Leaflet itself is vendored in `vendor/leaflet/`, so the map library always loads; if you ever delete
that folder, `js/app.js` fetches the same version from unpkg as a last resort.

---

## 🚏 Where the bus data comes from

`js/data.js` is **generated** by the pipeline in [`tools/`](tools/README.md) from two published route
lists. Don't hand-edit it:

```bash
curl -sL https://wbtconline.in/wbtc-city-bus-routes      -o tools/cache/routes.html
curl -sL https://www.kolbusopedia.com/bus-routes         -o tools/cache/kbo-private.html
curl -sL https://www.kolbusopedia.com/bus-routes-government -o tools/cache/kbo-govt.html

node tools/1-extract.js && node tools/1b-kolbusopedia.js \
  && node tools/2-geocode.js && node tools/3-emit.js
```

| Source | Contributes |
|---|---|
| `https://wbtconline.in/wbtc-city-bus-routes` | WBTC's official city routes (`src: "wbtc"`) |
| `https://www.kolbusopedia.com/bus-routes` and `/bus-routes-government` | private, minibus, C / D / E, K / KB, M / MM / MN, SD / DN and STA services (`src: "kolbusopedia"`) |
| [`tools/manual-routes.json`](tools/manual-routes.json) | newer services neither list carries yet (`src: "manual"`) |

```js
const KOLKATA_STOPS = { "Stop name": [lat, lng], ... };  // verified positions only
const BUS_STOPS    = ["Esplanade", ...];                 // every routable stop
const STOP_ALIASES = { "sec v": "Salt Lake Sector V", ... };  // merged-away spellings
const STOP_AREAS   = { "Salt Lake Sector V": ["SDF", "College More", ...], ... };

const BUS_ROUTES = [
  {
    no: "S3W", operator: "WBTC (CSTC)", type: "govt", src: "kolbusopedia",
    cat: "nonac", ac: false, km: 38.4, duration: 136,
    stops: ["Thakurpukur 3A", "Joka", "Thakurpukur", "Kadamtala",
            "Sakherbazar", "Behala Chowrasta", "Manton", "Behala Tram Depot", ...]
  },
  ...
];
```

**Search and the map read from different lists, on purpose.** Search uses `BUS_STOPS`, so every stop
either list names is findable. The map plots only `KOLKATA_STOPS`, the stops we can actually place —
so an unverified stop is never drawn in the wrong spot. The modal says how many of a stretch's stops
is mapped. `STOP_AREAS` adds locality search: a bus that stops anywhere inside `Salt Lake Sector V`
answers a search for it, while the map and the row still name the exact stop (`Thakurpukur → SDF`).
The localities currently indexed are **Sector V**, **New Town**, **Joka** and **Thakurpukur** — the
places whose buses are most often named after a *different* stop in the same area.

`STOP_ALIASES` closes the loop on merging. Once “Sec V” has been folded into “Salt Lake Sector V” the
short form is gone from `BUS_STOPS`, so the alias table keeps it searchable and the app explains the
substitution rather than appearing to ignore what you typed. It is built from every spelling the two
sources actually used, so it also covers “Bekbagan”, “Joka ESI Hospital”, “BKP Chiriamore”,
“Tata Cancer Hospital” and “C.I.T.Road”, among ~970 more.

Swap these objects with a real API response and the whole UI — search, sorting, filters,
bidirectional matching, one-change plans and the Leaflet map — keeps working. Keep each route
stored **once**, in any direction; the app handles the reverse.

### Merging duplicate stop names

The two lists spell the same place many ways, and a stop that exists twice splits the buses that
serve it across two rows. `tools/2-geocode.js` holds an explicit alias table for the synonyms and
misspellings, and `tools/3-emit.js` adds a fuzzy pass and a display-name scorer on top. Every merge is
written to `tools/cache/merge-report.txt`, and `tools/audit/dupes.js` re-checks the result.

What the audit enforces:

* **No two stops may normalise to the same string** — this is what caught “P. T. S”/“PTS”,
  “S. D. F”/“SDF”, “C.I.T.Road”/“CIT Road”, “City Center-1”/“City Centre 1”/“City Centre I”,
  “DumDum Chiria More”/“Dumdum Chiriamore” and “Dumdum Canton”/“Dumdum Cantonment”.
* **A pair that co-occurs on one route is never merged** — that proves they are two stops. This is
  why `Kakdwip` and `Kakdwip Bus Stand` stay apart (four SD-series routes call at both), and why
  `<village>` and `<village> Bazar` are left alone.
* **Anything merged must be corroborated** by a verified coordinate, so genuinely distinct places
  with similar names are not collapsed.

### Why about three quarters of stops have no position

The published stoppage text is free text, and automatic geocoding of Kolkata place names is
unreliable — it put `Narkel Bagan` 16 km away in Baghajatin and `Garia` 9 km from Garia, and collapsed
unrelated places such as `Shyambazar`/`Shyamnagar` and `Cannel Bridge`/`Dhalai Bridge` onto identical
points. Kolkata also has **two Mohanpurs, two Santoshpurs and two Bishnupurs**, so one name is not
always one place.

Rather than ship a map that is quietly wrong, a coordinate is accepted only from a verified anchor or
from a geocoded value that passes a route-geometry check, and any name that later turns out to sit in
two different parts of the city stops being plotted altogether. A coordinate that several unrelated
stops all claim is thrown out as a generic geocoder fallback. That leaves **481 of 1896 stops (25%)**
mapped — the average route is **66%** mapped, which is what the map shows. The rest are mostly rural
halts whose positions nobody has published; adding a verified position is a one-line append to
`tools/anchors.json`.

> Route numbers and stop sequences are as published by WBTC and Kolkata Bus-O-Pedia. Route lengths,
> ride times and stop coordinates are derived or approximate, and **no frequencies or departure times
> are shown because neither source publishes any**. Always confirm before you travel.

---

## ♥ Support

Buy me a coffee for much such cool projects.
**GPay / PhonePe:** `8017414711` · **UPI:** `8017414711@yespop`

* Instagram → [@ig_chromozome](https://instagram.com/ig_chromozome)
* WhatsApp → [+91 80174 14711](https://wa.me/918017414711)

---

## License

© BusBondhu · Kolkata. **All rights reserved.**