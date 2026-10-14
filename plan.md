# Rewrite plan

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
| P1    | Core data model (no UI)                    | Next        |
| P2    | Fast read-only viewer                      | Not started |
| P3    | Presets, validation, upload                | Not started |
| P4    | Floor plans                                | Not started |
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
| Tooling     | Bun 1.4 (package manager, scripts), Node 26, Biome 2.5 (format + lint), GitHub Actions          |
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

### P1: Core data model (no UI)

- `osm/*`: entities, graph, history, osmChange builder, diffResult parsing, OSM JSON parsing.
- `actions/*`: pure graph actions.
- `levels/*`: port `_listFeatureLevels`, `_parseLevelsFloat`, `_cleanLevelTag`
  (`VectorDataManager.js:2477-2586, 2664, 1027`) with the fixes above; never rewrite a tag the
  user didn't edit; flag comma decimals in validation instead of guessing.
- `api/*` against a mocked `fetch`; `persist/autosave`.
- Tests: level parse/format tables and a regression test per legacy bug; graph immutability and
  undo/redo; osmChange XML snapshots (ordering, placeholders, `if-unused`, multipolygon member
  removal); the ~45 legacy `_analyzeDiff` scenarios (from `VectorDataManager.test.js`) rewritten
  as action + osmChange tests.

### P2: Fast read-only viewer (Explore mode)

- Load OSM data over a z16 tile grid from zoom 17, with a cache and at most 4 parallel requests.
- Translate `public/style.mapcss` by hand into MapLibre layers (fill, line, symbol), including
  door widths and incline/conveying arrows; icons through `styleimagemissing`, rasterised at the
  device pixel ratio from Maki/Temaki and the legacy SVGs.
- Level selector from building levels; Nominatim search; imagery picker from the
  editor-layer-index (fetched once, filtered by bbox on debounced `moveend`; templates
  `{zoom}`, `{switch:}`, `{-y}`, WMS `{bbox-epsg-3857}`; keyed sources hidden without a key).
- Targets: smooth panning on a 10k-feature fixture, level switch < 50 ms, no polling timers.

### P3: Presets, validation, upload

- `scripts/build-presets.ts`: filter id-tagging-schema to indoor-relevant presets and emit
  presets, fields, `deprecated.json` and translations; local overlay for `level:ref`,
  `indoor=level`, repeat_on guidance and entries from the legacy `indoor.xml` that upstream lacks.
- Preset matching, search, recent presets; fields (text, number, combo, semiCombo, check) that
  respect delimiters; raw tag table.
- Validator with one-click fixes: `room=stairs` → `indoor=room` + `stairs=yes`;
  `room=elevator` → `indoor=room` + `elevator=yes`; `buildingpart=*` → `indoor=*`;
  `diaper` → `changing_table`; `building:height` → `height`; vertical features using `repeat_on`
  → `level=a;b;c`; empty keys/values; level outside the building; missing `indoor=level`
  outline; door not on a wall.
- PKCE login; changeset pane (comment, source, `review_requested`, `imagery_used`); atomic upload.
- E2E against a mocked OSM API that records the uploaded osmChange.

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
- History autosaved to IndexedDB with a restore prompt and a `beforeunload` guard.

### P6: Parity and polish

- i18n with Paraglide; migrate 1.x UI translations (en, fr, de, it, hu, cs, es).
- Keyboard shortcuts, help, indoor= preview (origin-checked `postMessage`), conflict dialog,
  README and usage docs. Release gate: an e2e checklist of 1.x features.

## Testing strategy

- Unit (Vitest, node environment): at least 90% coverage on `osm`, `levels`, `georef`.
- E2E (Playwright, Chromium with SwiftShader WebGL, `vite preview`): all external requests
  blocked or mocked through `tests/e2e/fixtures.ts`; a mock OSM API (`mock-osm.ts`, P3) with
  injectable 409/412 errors; rendering checked with `pixelAt()` rather than screenshots.
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
- **Name.** `package.json` is `indoor-id`; the UI still says OsmInEdit.
- **Legacy tag.** `legacy-v1.0.16` has to be pushed from a machine with tag permissions.
