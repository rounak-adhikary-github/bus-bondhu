# BusBondhu — project notes

Kolkata bus companion. **100% static site, no build step, no framework, no dependencies.**
`index.html` + `css/styles.css` + `js/app.js` + **generated** `js/data.js`.

## Non-negotiables
- **`js/data.js` is generated — never hand-edit it.** Edit the pipeline or alias tables, then:
  `node tools/1-extract.js && node tools/1b-kolbusopedia.js && GEOCODE_BUDGET=0 node tools/2-geocode.js && node tools/3-emit.js`
  (`GEOCODE_BUDGET=0` rebuilds from cache — fast, offline, idempotent.)
- **`tools/anchors.json` is frozen on purpose.** Stage 3 must never read coordinates back out of
  `js/data.js` — it overwrites that file, silently promoting generated values to "verified".
- **No invented timings.** Neither published list carries departure times or headways and no
  authoritative Kolkata timetable exists, so the dataset emits no clock times and the UI shows none.
  Do not reintroduce an ETA / frequency / "next bus" feature without a real source.

## Sources & shapes
Route numbers, origins, termini and stop sequences come from WBTC's official city route list plus the
Kolkata Bus-O-Pedia catalogue; `km`/`duration` are derived (`duration = km ÷ 17 km/h`); coordinates are
hand-verified anchors plus geocoded values that pass validation; frequencies are **absent by design**.
Emitted: `KOLKATA_STOPS` (verified `{name: [lat,lng]}`), `BUS_STOPS`, `STOP_ALIASES`,
`STOP_AREAS` (locality → member stops), `BUS_ROUTES`
(`{no, operator, type, src, cat, ac, km, duration, stops}`).

## Conventions
- Search reads `BUS_STOPS`, the map plots only `KOLKATA_STOPS` — an unplaced stop stays findable, it
  just gets no dot. Routes are stored **once**; the app serves both directions.
- `GROUPS` in `tools/2-geocode.js` is **last-write-wins**. Never declare the same key twice — the
  second silently overrides the first.
- Every spelling **declared** in `GROUPS` becomes searchable, whether or not a source ever used it.
  So if people plausibly type it, declare it — numeral *and* word forms (`sector 5`, `sec v`,
  `sector five`). Declaring is what makes it findable.
- `keyOf()` keeps spaces, so `p t s` and `pts` are different keys.
- Two names appearing on the **same route** are proof they are two stops — never merge. Deliberate
  non-merges are documented in a comment at the end of `GROUPS`; don't "tidy" them.
- `js/app.js` area folding must **add** routes, never reset `ROUTES_BY_STOP[area]` — locality names
  like `Joka` are also real stops.

## The stop picker is deliberately not a `<datalist>`
`<datalist>` does nothing on iOS Safari and several Android browsers — that was the reported bug.
The combobox is drawn in the DOM (`setupCombo` in `js/app.js`, `.combo*` in `css/styles.css`).
Load-bearing, don't "simplify":
- select on **`pointerdown` + `preventDefault()`** (a tap blurs the field before `click` lands);
  keep the `click` fallback *without* a `panel.hidden` guard
- rows **46px**; list scrolls with `overscroll-behavior: contain`
- flip above using **`visualViewport`**, not `innerHeight` (only the former shrinks with the keyboard)
- **never close on scroll** — the panel is anchored to the field and the keyboard scrolls the page
- inputs stay **16px** or iOS zooms on focus; empty field shows the busiest stops
- the open field's **wrapper** carries a `z-index`, not just the list. `.input-wrap:focus-within` has
  a `transform`, and a transform opens a stacking context that traps the list's own `z-index` inside
  the wrapper — the next field then paints across the middle of the dropdown and those rows become
  un-tappable. An overlay `z-index` is void if an ancestor has a
  `transform`/`filter`/`backdrop-filter`; lift the wrapper.

## Gotchas
- Never issue two `Edit` calls to the same file in one message — a write race silently drops one while
  still reporting success. Grep to confirm after editing.
- The submit handler renders after a **240 ms** `setTimeout`. Chain harness searches on a timer;
  reading the DOM synchronously after a submit loop captures all zeros.
- In headless Chromium `document.hasFocus()` is false, so `element.focus()` fires **no focus event**.
  Dispatch `new FocusEvent('focus')` explicitly.
- **Hit-test, don't eyeball.** `document.elementFromPoint()` at each row's centre is what proved the
  dropdown rows were covered; a screenshot alone looked plausible.
- `scrollWidth > clientWidth` is **false** for content clipped by `overflow-x: hidden`. To find that
  overflow, measure the element against its container's rect.
- `tools/audit/load.js` `findRoutes()` is a plain name match — it does **not** model locality folding
  or bidirectional matching, so counts are a lower bound (0 there can be 4 in the app). Never quote it
  as app behaviour; drive `index.html` in a browser for that.

## Audits (after regenerating)
`verify-coords.js` · `audit/dupes.js` (**pass: 0 normalisation collisions**) · `audit/glued.js` ·
`audit/load.js`. Details in `tools/README.md`.
