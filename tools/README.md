# Data pipeline

`js/data.js` is **generated**. Don't hand-edit it — edit the pipeline, the alias
tables or `manual-routes.json`, then regenerate.

```bash
# one-off: grab both published route lists
curl -sL https://wbtconline.in/wbtc-city-bus-routes -o tools/cache/routes.html
curl -sL https://www.kolbusopedia.com/bus-routes -o tools/cache/kbo-private.html
curl -sL https://www.kolbusopedia.com/bus-routes-government -o tools/cache/kbo-govt.html

node tools/1-extract.js        # WBTC table      -> ordered stop sequences
node tools/1b-kolbusopedia.js  # catalogue pages -> ordered stop sequences
node tools/2-geocode.js        # both sources    -> canonical stops + coordinates
node tools/3-emit.js           # merged          -> js/data.js
node tools/verify-coords.js    # audit the coordinates (worth running)
```

Stages 1b and 2 re-read everything from disk, so the only network step is the
three `curl`s (and Photon, if `tools/cache/coords.json` has gaps).

## Where the data comes from

| Field | Source |
|-------|--------|
| route numbers, origins, termini, stop sequences | **WBTC's official city bus route list** and **Kolkata Bus-O-Pedia's** private / minibus / C / D / E / K / KB / M / MM / MN / SD / DN / STA catalogue, attributed per route as `src` |
| route `km` | derived from the mapped stops (see below) |
| route `duration` | derived: `km ÷ 17 km/h` |
| `headway`, `first`, `last` | **assumed defaults** (neither source publishes frequencies or timings) |
| stop coordinates | hand-verified anchors + geocoded values that pass validation |

## Why a route number appears once

Most government numbers are published in *both* lists, and neither is complete:
WBTC prints the official endpoints, the catalogue usually names more stops. Two
rows for one bus would be wrong, so `3-emit.js` keeps the list that names **more
stops** and records both sources in `srcs`.

Interleaving the two lists was tried and rejected: the lists name the same
places differently (`Salt Lake Sector V` vs `SDF` vs `College More`), so slotted
stops landed in the wrong order and the route lines zig-zagged.

## Why the alias table matters

Both sources are free text. One place appears as `Esplanade` / `ESPL` /
`Esplanade East`, `Howrah Stn` / `HOWRAH STN` / `Howrah`, `Khidderpore` in seven
spellings — thousands of strings for a couple of thousand real stops.
`2-geocode.js` holds the alias table that collapses them, and `3-emit.js` then
merges the remaining one-word-apart pairs (`Sealdah` ↔ `Sealdah Station`) unless
both are placed and more than 1.2 km apart, in which case they are genuinely
different places and stay separate. Two traps worth knowing:

- `Sec5` is the literal **Sector V** stop. `Salt Lake` on its own (S-16's
  terminus) is the Karunamoyee-side hub — **not** the same place.
- Bare `Chowrasta` is ambiguous (Behala / Madhyamgram / Salkia). Don't merge it.

## Locality search (`STOP_AREAS`)

People ask for “Sector V”, not for “SDF”. `3-emit.js` emits a small
locality → member-stops map, and `js/app.js` indexes every route that stops at
any member under the locality name — while still plotting the exact stop it
uses, and still showing that stop in the row (`Thakurpukur → SDF`). A locality
only becomes searchable when it is itself a real stop name.

## Coordinates: verified only

Only stops we can actually vouch for get coordinates. `KOLKATA_STOPS` holds
those; `BUS_STOPS` holds every routable stop. The app searches over `BUS_STOPS`
and plots over `KOLKATA_STOPS`, so an unmapped stop is still findable — it just
doesn't get a dot.

`3-emit.js` accepts a coordinate only when it:

1. comes from `tools/anchors.json` (hand-verified), or
2. agrees with the route geometry — not tens of km from both neighbours on the
   routes it appears on, and not landing exactly on a different stop.

Then it drops the ones that turn out to be unplaceable after all:

- **Two places, one name.** Kolkata has two Mohanpurs, two Santoshpurs, two
  Padmapukurs and two Bishnupurs. For each occurrence of a name the script takes
  the midpoint of the stops either side of it on that route; if those midpoints
  disagree by more than 8 km *out of proportion to the local stop spacing*, the
  name is being used for two places and is no longer plotted (it stays
  searchable). Anchors are not exempt — a verified `Mohanpur` is only verified
  for the routes that go there.
- **Wrong locality.** A geocoded stop that sits far from both neighbours on a
  route whose other stops are close together is simply in the wrong place.

As of the last build: **595 of 2011 stops (30%)** are plotted — 200
hand-anchored, the rest geocoded and checked. The percentage is low because the
newer sources add hundreds of rural halts (Kona Expressway, Bongaon, Basirhat,
Kakdwip) whose positions we cannot corroborate; per route the average is 69%,
which is what the map actually shows. 1,603 names are cached in
`tools/cache/coords.json`; `GEOCODE_BUDGET=0 node tools/2-geocode.js` rebuilds
entirely from that cache, with no network calls. That check is not decorative — blind
geocoding put `Narkel Bagan` 16 km away in Baghajatin, `Garia` 9 km from Garia,
and collapsed unrelated places (`Shyambazar`/`Shyamnagar`,
`Cannel Bridge`/`Dhalai Bridge`) onto identical points.

## Route length, robustly

Summing the hops between consecutive stops assumes every plotted stop is where
it really is. One misplaced rural name would then add a phantom detour to the
whole route (`S3W` measured 77 km instead of 38 km). So the length is the
shortest path through the stops **in order**, where stepping over a stop costs
`SKIP_KM` (0.35 km): a stop genuinely on the way is cheaper to visit than to
skip, and a stop that would drag the line 20 km off course is not.

**`tools/anchors.json` is frozen on purpose.** `3-emit.js` must never read
coordinates back out of `js/data.js`, because it overwrites that file — doing so
feeds generated values back in and silently promotes them to “verified”.

## Adding a route neither list publishes

Add it to `tools/manual-routes.json` with its `source`, a `note` explaining
where the alignment came from, and the ordered `stops`, then re-run stages 2–3.
`EB-16` lives there: it is a real WBTC electric service that the published city
table does not carry, and its alignment comes from WBTC's relaunch notices and
depot posts rather than from a published table.

## Adding to the anchors

Append to `tools/anchors.json` as `"Stop Name": [lat, lng]`, using the canonical
name from the route table, then re-run stages 2–3. Anchors always win over
geocoded values.
