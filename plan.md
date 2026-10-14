# IndoorID rewrite plan

A client-only indoor editor for OpenStreetMap ([Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging)),
rewritten from OsmInEdit 1.0.16 (React 16, Leaflet, 2019). Legacy code: commit `cd1e955`
(`git show cd1e955:<path>`), to be tagged `legacy-v1.0.16`.

## Goals

1. **Fast map.** Smooth panning and zooming with thousands of indoor features; switching level
   in under 50 ms.
2. **Easy floor plan alignment.** Import PNG/JPG/WebP, PDF and SVG plans and place them with
   control points or a known distance instead of dragging corners.
3. **Up-to-date tagging.** Presets and validation that follow the current OSM wiki, with
   one-click upgrades of deprecated tags.
4. **Safe uploads.** What gets uploaded is exactly what the user edited, sent in one atomic
   changeset.

## Status

| Phase | Scope                                      | Status      |
| ----- | ------------------------------------------ | ----------- |
| P0    | Scaffold, tooling, map, URL hash           | Done        |
| P1    | Core data model (no UI)                    | Done        |
| P2    | Fast read-only viewer                      | Done        |
| P3    | Presets, validation, upload                | Done        |
| P4    | Floor plans                                | Next        |
| P5    | Geometry editing                           | Not started |
| P6    | Parity and polish                          | Not started |

## Why a rewrite (findings from the 1.x code)

- **Upload logic is the main source of bugs.** 1.x edits GeoJSON (via osmtogeojson), then a
  ~560-line heuristic (`_analyzeDiff`, `src/ctrl/VectorDataManager.js:1535-2095`) guesses which
  OSM nodes, ways and relations changed. Known failures:
  - the analysis promise can hang forever (no try/catch inside a `setTimeout`);
  - multipolygon matching crashes or maps two rings to one way (`splice(i, 0)` no-op, null
    dereferences);
  - deleting a relation member makes the upload fail part-way (HTTP 412);
  - it mutates the live edit cache with fake nodes whose ids can collide with new ones;
  - elements are sent one request at a time, so a failure leaves a half-uploaded, open
    changeset and a retry duplicates data;
  - re-downloading an area corrupts the cache (string version compare, duplicates).
- **Level bugs:** editing any tag can drop `level` (written as a number, then filtered out);
  unparseable levels are rewritten to `"0"`; decimal ranges don't round-trip;
  `building:levels=0` adds level -1; level 0 is treated as falsy (copy level fails on it);
  `repeat_on` is written for stairs and elevators instead of `level=0;1;2`.
- **Slow rendering:** SVG renderer, full layer rebuild on every state change, uncached MapCSS
  evaluation, turf buffers per render, a 1 s timer scanning the whole imagery index, floor
  plans kept as full-resolution images and only hidden with opacity.
- **Laborious floor plans:** arbitrary initial size, no control points or known-distance
  scaling, rotation only around the centre, no snapping, nothing saved across reloads.
- **Outdated tagging:** `room=*` as the primary type (`room=stairs`, `room=elevator`),
  `diaper`, `building:height`; missing `level:ref`, door and accessibility details, corridor
  lines, common indoor POIs.
- **Security:** an OAuth secret and API keys were shipped in `public/config.json` and CI. They
  are still in git history: never reuse them; register a new OAuth 2 app.
- Nearly every dependency (CRA, react-leaflet 2, leaflet-draw, Bootstrap 4, ...) is
  unmaintained, so modernising in place would have touched almost every file anyway.

## Stack

| Area        | Choice                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Tooling     | Bun 1.4 (package manager, scripts), Node 24+, Biome 2.5 (format + lint), GitHub Actions          |
| App         | SvelteKit 3 + `adapter-static`, every route `ssr = false` / `prerender = true`; Svelte 5 runes; TypeScript 6 strict |
| Map         | MapLibre GL JS 6 (WebGL), imported only via `#lib/map/maplibre.ts`                              |
| UI          | Tailwind CSS 4, bits-ui 2 (headless, accessible primitives), `@lucide/svelte`                   |
| Editing     | Custom engine modelled on iD's modes and behaviours, `rbush` spatial index, `@turf/*` v7        |
| OSM         | `osm-auth` 3 (OAuth 2 PKCE, no secret, no backend); small `fetch` client for the API v0.6      |
| Presets     | `@openstreetmap/id-tagging-schema` filtered at build time, plus a local indoor overlay; `fuse.js` |
| Storage     | IndexedDB via `idb` (floor plans, autosaved edits, settings)                                    |
| Floor plans | `pdfjs-dist` (lazy loaded); MapLibre `image` source with `setWarp("perspective")`               |
| i18n        | Paraglide (key/value JSON, compatible with Transifex)                                           |
| Tests       | Vitest (unit), Playwright 1.56.1 (e2e, matches the preinstalled Chromium)                       |

Decisions already discussed:

- **SvelteKit, not a bare Vite SPA:** static output either way; Kit adds routes (OAuth callback,
  help), `$app/*` helpers and conventions.
- **osm-auth, not Better Auth:** users must sign in to openstreetmap.org and their edits are
  attributed to their OSM account. Better Auth needs our own server and database and would hold
  every user's OSM write token. Revisit only if a backend is added (e.g. shared floor plan
  libraries); `lib/api/auth.ts` stays behind a small interface.
- **Custom editing engine, not terra-draw:** OSM topology needs shared nodes (walls between
  rooms, doors on walls), which terra-draw doesn't model. Every gesture becomes a graph action,
  so the upload is exactly what the user did.

## Architecture

```
src/lib/
  osm/         entity, graph, history, difference, osmchange, diffresult, parse-json, geometry, tags
  actions/     add-node, move-node, add-way, add-vertex, delete, change-tags, orthogonalize,
               copy-level, copy-paste, join-node-to-way
  levels/      parse, format, feature-levels, building-levels
  api/         http, auth, map-loader (tile-grid cache), changeset, conflicts, nominatim
  presets/     load, match, search, fields, recent, overlay/indoor.json
  validation/  rules/*, upgrades (deprecated tag → one-click fix)
  map/         maplibre (entry point), hash, sources (graph → GeoJSON), style/*, imagery/*
  edit/        modes/{browse,select,draw-point,draw-line,draw-area,drag,floorplan-align},
               behaviors/{hover,snap,keys,hit-test}
  floorplans/  import/{raster,pdf,svg}, georef/{similarity,affine,homography,fit}, tiling, store
  persist/     idb, autosave
  state/       editor.svelte.ts, session.svelte.ts, floorplans.svelte.ts
  ui/          layout, panes, components
```

- **Pure modules** (`osm`, `levels`, `actions`, `presets`, `validation`, `floorplans/georef`)
  have no DOM or Svelte dependency and carry most of the unit tests. Enforce with Biome
  `noRestrictedImports` overrides once these modules exist.
- **Data model (iD-like):** immutable nodes, ways and relations keyed by id (`n12`, `w-3`); a
  graph holds base (server) entities plus local changes, with parent-way and parent-relation
  indexes; history is a stack of graphs, so undo/redo is replacing a reference. Stored in
  `$state.raw`.
- **Upload:** the osmChange is the difference between base and head graphs. Order: create nodes,
  ways, relations; modify; delete relations, ways, nodes with `if-unused`. One request to
  `/changeset/{id}/upload`; ids and versions remapped from the diffResult (integer compare).
  Warn above 10k changes.
- **Re-download merge:** same version → skip; newer on server and untouched locally → replace;
  newer on server and edited locally → conflict.
- **Map sources:** one GeoJSON source with `promoteId: "id"`; each feature carries `_lv`
  (`";-1;0;0.5;"`), and layers filter on it, so a level switch is a `setFilter`, not a data
  rebuild. Edits push `updateData()` with only the changed features; dragging updates a small
  overlay source and commits on pointer up.

## Phases

Each phase ends with lint, check, unit and e2e tests green, and a status update in this file.

### P0: Scaffold — done

- Legacy code removed (kept at `cd1e955`); SvelteKit 3, Svelte 5, Tailwind 4, bits-ui,
  MapLibre 6; Bun, Biome, Vitest, Playwright, CI; `CLAUDE.md` and project skills.
- Map with keyless OpenFreeMap basemap from `static/config.json` (no secrets).
- URL hash `#zoom/lat/lon/level`, compatible with 1.x links, keeping fractional zooms and
  decimal levels; level up/down control.
- Lesson: MapLibre 6 under Vite needs `setWorkerUrl()`; covered by an e2e test that checks a
  GeoJSON polygon actually renders.

### P1: Core data model — done

140 unit tests, all through the agreed seams (public functions; HTTP mocked at `fetch`).

- `levels/`: `parseLevels`, `formatLevels`, `isOnLevel`, `featureLevels`. Levels are ranges, so
  `0-2` covers a 0.5 mezzanine but `0;1` doesn't. Unreadable values (`G`, `1,5`) return null
  instead of becoming level 0; `building:levels=0` no longer invents level -1; IndoorOSM
  `buildingpart:verticalpassage:floorrange` is no longer read (validation will flag it).
- `osm/`: immutable entities with iD-style ids, `Graph` (server data + local edits, parent
  indexes, `newId`, `changes()`), `History` (graph snapshots), `buildOsmChange` and
  `applyDiffResult` (tiny parser, no XML dependency).
- `actions/`: `changeTags`, `addNode`, `moveNode`, `addWay`, `insertNodeInWay`,
  `deleteEntities` with iD-style cleanup. The 1.x `_analyzeDiff` scenarios that still apply are
  covered; the ones about guessing topology from coordinates disappear with the graph model.
- `api/`: `OsmApi.loadMap(bbox)` and `OsmApi.upload(graph, tags)` (one request, changeset always
  closed, typed errors).

Moved out of P1: autosave and orthogonalize / copy level / copy-paste → P5 (they need the
editing UI); merging re-downloaded data into the graph → P2 (map loader); OAuth login → P3.

### P2: Fast read-only viewer — done

228 unit tests and 17 browser tests in total; the browser tests check rendered pixels.

- Data: `map/tiles.ts` (slippy-map tiles), `api/map-loader.ts` (each zoom-16 tile downloaded
  once, at most 4 at a time, failed tiles retried on the next move, zoomed-out views skipped),
  `History.merge` (same version → skip; newer and untouched → replace; newer and edited locally
  → conflict, local edit kept).
- Features: `map/features.ts` turns the graph into GeoJSON (areas, lines, tagged points,
  multipolygons with holes). Each feature carries `@lv` (known levels it covers), so a level
  switch is a `setFilter`, never a data rebuild. `map/classify.ts` decides `@kind`, `@icon`,
  `@label`, `@restricted` in code instead of long style expressions.
- Style: `map/style/layers.ts` (fills and lines under the basemap labels, doors and labels
  above), validated with MapLibre's validator; 1.x icons bundled and rasterised on demand at
  the screen's pixel density through MapLibre 6's `setMissingStyleImageResolver`.
- UI: `EditorView` with the `Editor` state class, a level selector built from the data,
  Nominatim search on submit (`nominatim_url`), and a Background panel listing
  Editor Layer Index imagery for the view (`imagery_index_url`; TMS, `{switch:}`, `{-y}`, WMS in
  EPSG:3857; Bing, keyed and long-expired sources left out).
- Performance: no polling timers. Measured in Node on 10,000 rooms (50,000 entities): merging 9
  tiles 64 ms in total, building all features 85 ms. Each downloaded tile still rebuilds every
  feature; incremental `updateData()` comes with editing (P5). The level-switch time has not been
  measured in a real browser yet (headless tests use software WebGL).

Moved out of P2: Maki/Temaki icons → P3 (they come with the presets); door widths and
incline/conveying arrows → P5.

### P3: Presets, validation, upload — done

295 unit tests and 28 browser tests in total.

- Presets: `scripts/build-presets.ts` keeps 1,049 presets and 396 fields of
  `@openstreetmap/id-tagging-schema` 7.3 (indoor, amenity, shop, door and entrance, elevator,
  steps, corridor and other features found inside buildings) with English labels, plus
  `deprecated.json`; `presets/overlay.json` adds "Indoor Level Outline" (`indoor=level`,
  `level:ref`), a generic Door preset and door fields (`swinging`, `automatic_door`, `handle`).
  `PresetIndex` matches like iD (indexed by key, cached per tags object) and searches by name
  and terms.
- Inspector: click to select (feature-state highlight), preset name and icon, "Change type"
  picker (defaults per geometry, search), fields (text, combo with suggestions, check, select,
  textarea), raw tag text, undo/redo buttons and shortcuts, Escape to deselect.
- Validation (`validation/validate.ts`) on the selected feature and on every edited one before
  upload, with one-click fixes: outdated tags (`room=stairs|elevator`, `buildingpart=*`, and the
  schema's `deprecated.json`, e.g. `diaper` → `changing_table`); vertical features using
  `repeat_on` → `level=a;b;c`; unreadable levels (a comma explains `;`, no guessed fix); door
  not on a wall or room outline.
- Login and upload: osm-auth popup with PKCE and `/auth/callback`; upload dialog with comment,
  source, review request and `imagery_used` from the backgrounds picked; one atomic osmChange;
  each API error explained, with the edits kept. The e2e test asserts the exact osmChange.
- Icons: the presets' Maki and Temaki icons (CC0) on the map and in the inspector, falling back
  to the 1.x icons; rooms, walls, doors and other structure get none. Icon files are loaded on
  demand rather than inlined in the bundle.
- Performance: building the features of 10,000 rooms with presets takes ~290 ms the first time
  (matching every preset) and ~40 ms after, thanks to the match cache.

Moved out of P3: the spatial rules (level outside the building's levels, missing `indoor=level`
outline) and the empty key/value check → P5, with the geometry tools; translations of presets
and recent presets → P6 (i18n); number fields and semiCombo lists edited as plain text for now
(values are kept as typed, never rewritten). Upload tests mock the API with `page.route` in each
test instead of a shared `mock-osm.ts`.

### P4: Floor plans

- Import: raster via `createImageBitmap` (downscaled to the GPU texture limit); PDF page picker
  with thumbnails and DPI (default 150); SVG rasterised from an `<img>` blob URL (no scripts).
- Georeferencing in EPSG:3857, residuals in true metres (× cos lat): 2 points → similarity;
  3+ → least-squares similarity or affine; 4+ → projective, rendered with MapLibre 6's
  `setWarp("perspective")`.
- Tools: measure a known distance to set the scale; rotate about a pinned point; numeric scale,
  rotation, offset and opacity (default 0.5); control points snap to OSM nodes and the building
  outline; each plan assigned to a building and level.
- Plans over 2048 px split into tiles. Stored in IndexedDB; JSON export/import, including the
  1.x format (old corners → affine transform).

### P5: Geometry editing

- Modes: browse, select/multi-select, drag node (moves every parent way), draw point, line, area;
  snapping (rbush, 8 px, current level only).
- Operations: add vertex at midpoint; delete with cleanup (keep POI and shared nodes, drop empty
  relations); door on wall; orthogonalize (port iD's current action); copy/paste features and
  tags; copy level.
- Building, Levels and Features workflows; simple multipolygons (outer + inner).
- Door widths and incline/conveying arrows on the map; incremental source updates on edit.
- Spatial validation (from P3): level outside the building's levels, missing `indoor=level`
  outline; empty keys or values.
- History autosaved to IndexedDB with a restore prompt and a `beforeunload` guard.

### P6: Parity and polish

- i18n with Paraglide; migrate 1.x UI translations (en, fr, de, it, hu, cs, es); preset and
  field translations from the schema; recent presets in the type picker.
- Keyboard shortcuts, help, indoor= preview (origin-checked `postMessage`), conflict dialog,
  README and usage docs. Release gate: an e2e checklist of 1.x features.

## Testing strategy

- Unit (Vitest, node environment): at least 90% coverage on `osm`, `levels`, `georef`.
- E2E (Playwright, Chromium with SwiftShader WebGL, `vite preview`): all external requests
  blocked or mocked through `tests/e2e/fixtures.ts`; the OSM API mocked per test with
  `page.route` (including 409/412 errors); rendering checked with `pixelAt()` rather than screenshots.
- TDD per the `tdd` skill: agree on seams before writing tests.

## Risks

| Risk                                                 | Mitigation                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Size of the custom editing engine                    | Follow iD's design; mouse first, basic touch                |
| WebGL needs CORS on imagery tiles (Leaflet didn't)   | Detect failing sources and mark them unavailable            |
| GPU texture limits (4096 px on many mobiles)         | Downscale or tile floor plans                               |
| Upstream preset gaps and version churn               | Pin the schema version; local overlay                       |
| OAuth redirect URIs per domain                       | Separate client ids per deployment in `config.json`         |
| Biome's Svelte support is still experimental         | Keep `svelte-check` in CI; fall back to Prettier for `.svelte` if formatting breaks markup |
| Losing 1.x features                                  | Legacy code kept at `cd1e955`; P6 parity checklist          |

## Open questions

- **License.** `package.json` says MIT, while 1.x is ISC (© Adrien Pavie, Daimler AG). The ISC
  notice must be kept with any ported code (level logic, style, presets), and the repo needs a
  `LICENSE` file.
- **Legacy tag.** `legacy-v1.0.16` has to be pushed from a machine with tag permissions.
