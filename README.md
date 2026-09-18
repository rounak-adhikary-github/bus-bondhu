# 🚌 BusBondhu — Kolkata's Bus Companion

> **বাসবন্ধু** — find any bus across Kolkata, with route maps and travel estimates.

A single-page, dependency-light website that helps you figure out **which buses run between two Kolkata
stops**, sorted by the soonest bus, with a route map for every service.

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
> | **Derived** | route length and journey time, computed from the mapped stops |
> | **Estimated** | frequencies and departure times — **neither list publishes any** |
>
> Neither list carries timetables, so every “every ~15 min” and “next bus at 12:52” on this site is a
> clearly-labelled estimate, not an official timing. Stop positions are approximate, and most stops
> have no position at all (see below). **For anything that matters, check with the operator.**
>
> The catalogue is community-maintained, not official: if a bus number matters to you, confirm it
> before you travel. Every route is attributed, so you can check any row against its source URL.

---

## ✨ Features

| # | Feature |
|---|---------|
| 1 | Cool, Kolkata-flavoured brand — **BusBondhu** with a live Kolkata clock |
| 2 | **4 inputs**: source, destination, time (15-minute dropdown), AM/PM |
| 3 | Time + AM/PM are **optional** → auto-fills current **Kolkata** local time |
| 4 | **Search** shows every bus departing in the **next 2 hours** — government, private, minibus and STA |
| 5 | Click any bus → **route map**, total **km** and estimated **travel time** |
| 6 | Every unique bus shown in its **own row**, bus number big & legible |
| 7 | High-frequency buses (≤ 20 min headway) are **not repeated** — a glowing
      **“⚡ Every X min”** badge replaces the duplicates |
| 8 | Results sorted so the **next bus is on top**; the last one in the window is at the bottom |
| 9 | **Glassmorphism**, **neomorphism** and buttery **transitions** everywhere |
| 10 | “Buy me a coffee” section with **Instagram** + **WhatsApp** buttons |
| 11 | Footer with **All rights reserved** |
| 12 | Routes run **both ways** — a bus that lists Barasat last still takes you Barasat → Esplanade |
| 13 | No direct bus? We suggest the **nearest connecting stop**, or a **one-change journey** |
| 14 | **Shareable links** — every search is written to the URL (`?from=…&to=…&at=…`), back/forward work |
| 15 | **No API keys anywhere**, and Leaflet is **vendored locally** so the map never depends on a CDN |
| 16 | **537 real routes** with their published stop sequences, from WBTC + Kolkata Bus-O-Pedia |
| 17 | Search by **locality** — “Sector V” finds buses that stop at SDF, College More or Technopolis |

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
│   ├── data.js        # GENERATED: 537 routes + verified stop coordinates + localities
│   └── app.js         # time logic, route matching, sorting, frequency merge, Leaflet map
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

* Each route in `js/data.js` has an ordered list of `stops` as published, plus a `headway`,
  a `first`/`last` departure time (minutes from midnight), total `km` and total `duration` — the last
  four being estimates, since no published list carries a timetable.
* Searching a **locality** (`STOP_AREAS`) matches every route stopping anywhere inside it, using the
  exact member stop for the segment maths and the map.
* Routes are **bidirectional**. A route is stored once, in one direction, and the app also serves it
  in reverse — a bus that lists Barasat last still runs Barasat → Esplanade. For the reverse trip the
  “distance already travelled” is measured from the far terminus, which is what `first`/`last` describe.
* For a search, the app finds the **segment** between your source and destination on each route.
* It then enumerates every departure from your source that falls inside your 2-hour window and keeps
  the earliest one as the bus’s “next” time.
* Rows are **sorted by that next time**, so the soonest bus floats to the top.
* High-frequency routes are **collapsed into one row** with a frequency badge — exactly as intended.

Travel time and distance for a segment are estimated proportionally along the route
(`duration × fraction`, `km × fraction`), and a rough “reaches ~” ETA is shown per bus.

### When nothing runs direct

Kolkata routes funnel through a handful of hubs, so a cross-city pair often needs one change. The
empty state handles that in two steps, and both go through the **same** `computeRows()` engine as a
real search, so nothing shown can fail to deliver when you act on it:

1. **Nearest stops that do connect** — up to four stops within 4 km that make the trip work if you
   board or alight there instead. Clicking a chip re-runs the search from that stop.
2. **Or change buses once along the way** — up to two one-change plans with real departure/arrival
   times for each leg and a door-to-door total (`TRANSFER_BUFFER` minutes are allowed at the hub).

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
const STOP_AREAS   = { "Salt Lake Sector V": ["SDF", "College More", ...], ... };

const BUS_ROUTES = [
  {
    no: "S3W", operator: "WBTC (CSTC)", type: "govt", src: "kolbusopedia",
    cat: "nonac", ac: false, headway: 15, first: 300, last: 1350,
    km: 38.4, duration: 136, est: true,
    stops: ["Thakurpukur 3A bus stand (Joka)", "Joka", "Thakurpukur", "Kadamtala",
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
The localities currently indexed are **Sector V**, **New Town** and **Joka** — the three places whose
buses are most often named after a *different* stop in the same area.

Swap these objects with a real API response and the whole UI — search, sorting, frequency merging,
filters, bidirectional matching, one-change plans and the Leaflet map — keeps working. Keep each route
stored **once**, in any direction; the app handles the reverse.

### Why about a third of stops have no position

The published stoppage text is free text, and automatic geocoding of Kolkata place names is
unreliable — it put `Narkel Bagan` 16 km away in Baghajatin and `Garia` 9 km from Garia, and collapsed
unrelated places such as `Shyambazar`/`Shyamnagar` and `Cannel Bridge`/`Dhalai Bridge` onto identical
points. Kolkata also has **two Mohanpurs, two Santoshpurs and two Bishnupurs**, so one name is not
always one place.

Rather than ship a map that is quietly wrong, a coordinate is accepted only from a verified anchor or
from a geocoded value that passes a route-geometry check, and any name that later turns out to sit in
two different parts of the city stops being plotted altogether. That leaves **595 of 2011 stops
(30%)** mapped — the average route is **69%** mapped, which is what the map shows. The rest are mostly
rural halts whose positions nobody has published; adding a verified position is a one-line append to
`tools/anchors.json`.

> Route numbers and stop sequences are as published by WBTC and Kolkata Bus-O-Pedia. Frequencies,
> first/last times, route lengths and journey times are not published by either and are therefore
> estimates — `est: true` on every route flags this — and stop coordinates are approximate. Always
> confirm before you travel.

---

## ♥ Support

Buy me a coffee for much such cool projects.
**GPay / PhonePe:** `8017414711` · **UPI:** `8017414711@yespop`

* Instagram → [@ig_chromozome](https://instagram.com/ig_chromozome)
* WhatsApp → [+91 80174 14711](https://wa.me/918017414711)

---

## License

© BusBondhu · Kolkata. **All rights reserved.**