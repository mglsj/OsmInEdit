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
| P4    | Floor plans                                | Done        |
| P4.1  | Floor plan layers, edit sessions, align UX | Done        |
| P5    | Feature editor, fast core, geometry        | Next        |
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
| UI          | Tailwind CSS 4, shadcn-svelte components (vega style, on bits-ui 2), `@lucide/svelte`           |
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
  textarea), raw tag text, undo/redo buttons and shortcuts, Escape to deselect. It opens in
  the side panel on the left, which the floor plan editor uses in floor plan mode.
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

### P4: Floor plans — done

324 unit tests and 39 browser tests in total.

- Georeferencing (`floorplans/georef.ts`, pure): least-squares fits in Web Mercator from control
  points (similarity from 2, affine from 3, perspective from 4), residuals and RMS in ground
  metres, image corners for MapLibre, the pixel under a map position, a starting placement,
  scaling to a measured distance, rotation about a pinned pixel, moving onto one point. Tested
  against spherical geometry at several latitudes.
- Plan files (`floorplans/plan-file.ts`, pure): IndoorID JSON export/import (images as data
  URLs), and OsmInEdit 1.x `osminedit_floor_imagery.json`. 1.x corners become an exact
  perspective transform (as 1.x drew them with CSS `matrix3d`) instead of the affine first
  planned, which would have reshaped plans that are not parallelograms.
- Import (`floorplans/import.ts`): PNG/JPEG/WebP through `createImageBitmap` (scaled down past
  8192 px); SVG rendered through an `<img>`, so its scripts never run; PDF page picker with
  thumbnails and DPI (default 150). pdf.js is lazy-loaded from its legacy build: pdf.js 6 uses
  JavaScript (`Map.getOrInsertComputed`) that current browsers lack.
- Drawing (`map/floorplan-layers.ts`): plans cut into tiles of at most 2048 px, each a MapLibre
  image source warped in perspective, above the indoor fills and below their outlines and
  labels, half-transparent by default, updated by identity (moving only sets coordinates).
  MapLibre doesn't mipmap image sources, so each plan is imported as a pyramid of halved
  images and the map draws the level matching the zoom: large plans keep their thin lines
  when shown small.
- Alignment (`state/floorplans.svelte.ts`, `ui/FloorPlansPanel.svelte`): control points (click
  the plan, then the map; snaps to OSM nodes within 8 px) with per-point residuals and the fit
  kind; measuring a known distance; rotating about a picked spot; opacity. Map clicks go to the
  active tool instead of selecting OSM features.
- Storage (`persist/plan-store.ts`, `idb`): images and settings in IndexedDB, restored on
  reload. Each plan has a level and shows only on it.
- Floor plan mode (as in 1.x): the map shows only building outlines (any area with a
  `building` tag, malls included); OSM selection, the feature editor and the edit toolbar are
  off, and the floor plans are edited in the left side panel. New plans go in the middle of
  the map beside that panel. As in photo editors, the selected plan is dragged to move it, by a corner handle to
  resize it around the opposite corner (`georef.dragCorner`: Shift stretches, Ctrl/⌘ resizes
  from the centre, Alt moves that corner alone, giving a perspective), and by the handle above
  it to turn it around its centre (`georef.dragRotation`, Shift for 15° steps). Drags are
  previewed live and saved on release (`map/plan-dragging.ts`).

Moved out of P4, to P5 with the editing tools: snapping control points to building outlines
(edges, not only nodes), numeric offset inputs, and assigning plans to a building. pdf.js standard fonts are not bundled yet: PDFs that rely on non-embedded fonts render
with fallback fonts (P6).

### P4.1: Floor plan layers, edit sessions, align fixes — done

Feedback from placing real plans (Vindhya Bhavan, 4-page A3 PDF). Decisions agreed with the
user are marked ✔; the rest follow from them.

**Align tool fixes**
- Crosshair cursor whenever an align tool is on. Today the class on the canvas container loses
  to MapLibre's `.maplibregl-canvas-container.maplibregl-interactive { cursor: grab }`, so the
  cursor is set on the canvas element itself, like plan dragging does.
- Measure: a dashed line follows the pointer from the first spot; after the second click it
  stays, solid, between the two spots until Scale or a new measure ✔.
- A Clear button removes every control point of the plan in Edit and any half-done measure or
  rotate pick; the plan stays where the points put it ✔.

**Layer list** (the sidebar list becomes the floor plan mode's layer stack)
- Top of the list is drawn on top. Rows reorder by a drag grip, or Alt+↑/↓ with the grip
  focused ✔; the map's layer order follows.
- A Buildings entry (the pink outlines) sits in the same list: it can be moved between plans
  and hidden. Its position and visibility are saved in the browser and in exported plan
  files ✔.
  New plans go above the other plans (under the outlines when those are on top). Stored
  `order` counts the outlines' place too; the outlines' record lives in IndexedDB's
  `settings` store (database version 2). Importing a plan file puts the outlines where the
  file had them among its plans.
- Each plan has its own colour, picked at random among a palette of distinct colours not yet
  used (never the buildings' pink). In floor plan mode every visible plan has a frame in its
  colour; the plan in Edit also gets its handles in it. The row shows a swatch; in Edit the
  swatch opens the palette to change it ✔. Plans saved before P4.1 get a colour on restore.
  (`floorplans/colors.ts`.)
- Clicking a row switches the map to the plan's level: a plan on every level leaves the level
  alone; with several levels (`0;1`, `0-2`) the map stays if the shown level is one of them,
  else goes to the lowest ✔. (`levels.levelToShow`; pressing Edit does the same.)
- The header button that leaves floor plan mode becomes Close ✔.

**Edit sessions**
- Plans are locked by default: they can't be dragged, aligned or changed. A row's Edit
  unlocks that plan (one at a time); name, level, opacity, colour, placement and the align
  tools all need Edit ✔. A locked row only has show/hide, Edit and delete.
- In Edit, changes are previewed but not saved; Done saves them, Cancel restores the plan as
  it was when Edit was pressed ✔. Leaving floor plan mode, or pressing another plan's Edit,
  with unsaved changes asks to save or discard. Reordering and show/hide are not part of a
  session: they save at once.
- The name is edited inline: in Edit, the row's name becomes a text field ✔ (slice 5).
- Imported plans open in Edit, saved as imported. `FloorPlans.whenSaved` asks before anything
  that would end a session with unsaved changes (Close, Escape, another plan's Edit, Import),
  through `ui/UnsavedPlanDialog.svelte`: Save, Discard or Keep editing.

**PDF import**
- The page picker takes several pages. Each becomes its own plan, `file, page N`, all in the
  same spot on the level shown ✔ (changed by the user from one level apart).

**Slices and test seams** (to agree before writing tests)
1. ✅ Align fixes. Unit: `toolFeatures` with a pointer position (dashed segment, then solid
   pair); `FloorPlans.clearPoints()`. E2E: canvas cursor is `crosshair` for each tool; the
   measure line's colour is drawn under the pointer; Clear empties the control point list and
   leaves the plan in place.
2. ✅ Colours. Unit: `floorplans/colors.ts` `pickColor(used, random)` (unused first, never pink);
   plan file round trip with `color`, and files without one. E2E: a plan's frame is drawn in
   its colour, a second plan in another.
3. ✅ Edit sessions. Unit (`FloorPlans` with a fake store): `edit`, `done`, `cancel`; nothing is
   stored before Done; Cancel restores transform, control points and settings; one plan in
   Edit at a time. E2E: a locked plan doesn't move when dragged; Edit → drag → Cancel puts it
   back; Edit → drag → Done survives a reload; Close with unsaved changes asks.
4. ✅ Layer list. Unit: `FloorPlans.move(id, index)` including the buildings entry, saved
   order; `FloorPlanLayers` order as MapLibre layer ids bottom to top (pure helper). E2E:
   two overlapping plans, reordered with the grip and with Alt+↑, show the top one's colour
   where they overlap; buildings moved under a plan are hidden by it; buildings hidden.
5. ✅ Rows. Unit: `levelToShow(planLevel, shown)` with `null`, `0`, `0;1`, `0-2`, `-1`. E2E:
   clicking a row switches the level; inline rename saved by Done, dropped by Cancel.
6. ✅ PDF pages. E2E: importing pages 1 and 2 of `plan.pdf` adds two plans, both on level 0.

### P5: Feature editor, fast core, geometry editing — next

Order agreed with the user: quick performance fixes, then the iD-style feature editor, then
the fast core (needed before anything is dragged), then geometry editing. Decisions agreed
with the user are marked ✔. Each slice agrees its test seams before tests are written.

#### P5.0 Quick performance fixes — done

Measured on a synthetic area of 10,000 rooms (50,000 entities, 3.2 MB of GeoJSON).
- Downloaded tiles are merged one by one, each followed by a full feature rebuild (71–116 ms,
  up to 64 tiles): buffer tile results and merge once per animation frame
  (`api/map-loader.ts`, `state/editor.svelte.ts`).
- `Editor.editCount` is a getter that recomputes `graph.changes()` on every read: make it a
  `$derived`.
- Floor plan pyramid levels flip back and forth when zooming across a switch point (each flip
  re-uploads every tile texture): add hysteresis (±0.25 in log2) in `map/floorplan-layers.ts`.
- Cheap extras: normalise preset names and terms once (first search 184 ms, then 3 ms per
  keystroke), look up parent relations only for entities without a `level` of their own, and
  save a plan reorder in one IndexedDB transaction.

#### P5.1 Feature editor, as in iD

Slices: (1) ✅ preset data: field properties, universal fields, categories
(`generated/categories.json`); (2) ✅ layout and sections (`ui/InspectorSection.svelte`); (3) ✅ feature type
list (`ui/PresetList.svelte`, `presets/recent.ts`); (4) ✅ Fields
section (`presets/field-list.ts`, `ui/FieldsSection.svelte`); (5) ✅ combo, chip and choice fields with taginfo (`api/taginfo.ts`,
`presets/combo.ts`, `presets/choice.ts`, `ui/ComboField.svelte`, `ui/ChipsField.svelte`,
`ui/CheckField.svelte`, `ui/RadioField.svelte`); (6) text, number, date, colour,
localized, address and access fields; (7) Wikidata, Wikipedia and wiki references; (8) tag
table; (9) relations and members; (10) one undo step per field edit. Hover preview and
multi-selection come with P5.3.

The inspector is rebuilt to follow iD's entity editor (`modules/ui/inspector.js`,
`entity_editor.js`, `sections/*`, `fields/*`), with shadcn components.
- **Layout**: a header ("Edit feature", or "Edit features" for several; back to "Change
  feature type"; close, shown as ✓ once something changed) and collapsible sections, each
  remembering whether it is open ✔: "Features (N)" (multi-selection only), "Feature Type"
  (preset icon and name, ⓘ), "Issues (N)", "Fields", "Tags (N)" (collapsed by default, open
  for features without a matching preset ✔), "Members (N)" (relations), "Relations (N)"
  (parent relations). Footer: "View on openstreetmap.org", last edited when and by whom
  (hidden for new features) ✔.
- **Feature type list** (slides in over the editor): search ranked like iD (names and aliases
  at word starts, without accents, terms, tag values, fuzzy matches, `key=value`) ✔, up to 8
  recent presets per geometry (30 kept) ✔, IndoorID's indoor defaults (`DEFAULT_PRESETS`,
  not the schema's) ✔, categories that expand in place ✔, ⓘ on each row (with slice 7),
  keyboard navigation (↑↓, Enter picks the highlighted row, the first by default, → and ←
  open and close a category) ✔. Choosing a preset follows iD's `actionChangePreset` ✔:
  drop the old preset's `removeTags` and field defaults and the field keys the new one does
  not use, then add the new `addTags`, `area=yes` when needed and field defaults. Two
  indoor rules on top ✔: `level`, `level:ref` and `repeat_on` always stay, and a feature
  with a level or `indoor=*` gets no `building` default (iD's `building_area_yes` would make
  a room turned cafe a building).
- **Fields** ✔: the preset's fields, then its `moreFields` and the universal fields (by
  label) once they have a value or were added; an "Add field" combobox for the others,
  universal ones last (matching labels, terms and keys; adding sets the field's default).
  Each label row: remove (clears all the field's keys), revert (back to the downloaded
  values), ⓘ (with slice 7), and a lock for locked fields (iD's rule: `name` when the
  feature has `wikidata` or `name:etymology:wikidata`). `prerequisiteTag` hides a field
  until its condition is met, unless it has a value. Fields for some countries only (US
  GNIS, French SIRET…) are left out of the build: IndoorID doesn't know the country. The preset build keeps the field properties this needs (option titles
  and descriptions, `universal`, `prerequisiteTag`, `snakeCase`, `caseSensitive`,
  `customValues`, `increment`, `minValue`/`maxValue`, `urlFormat`/`pattern`, `terms`,
  `reference`, `default`) and the preset categories.
- **Field types**: all of iD's except road ones ✔ (no turn-restriction editor, maxspeed or
  height units, oneway reversal or cycleway sides; those keys get plain combo/text fields):
  - combo, typeCombo, networkCombo ✔: dropdown of preset options (with titles) and taginfo
    values, snake_case and lowercase unless the field says otherwise, read-only when
    `customValues` is false (Backspace takes the value off); iD's inline completion and
    fuzzy filter; a value is only written once the user changed something;
  - multiCombo, manyCombo (chips for `key:*=yes`, with a yes/no box), semiCombo (chips for
    a `;` list, reorderable by dragging or Alt+←/→) ✔; typed values are split at `;` and
    commas before being spelled (iD snake_cases first: "Thai, pizza" gave `_pizza`);
  - check, defaultCheck (tri-state unset/yes/no; unset/yes), radio, structureRadio (with
    its type field and layer; a layer already on the right side of the ground stays) ✔;
    onewayCheck is a plain check (no reversal);
  - text, tel, email, url and identifier (with link), schedule, date (picker), colour
    (swatch and picker), number and integer (− / + steppers, min/max), textarea (255
    characters);
  - localized (name plus `name:<lang>` rows), address (street, place, city and postcode
    suggested from nearby loaded data), access, wikidata and wikipedia (searching those
    sites, each filling the other).
- **Tags (N)**: a table of key and value inputs with a delete button, an always-present empty
  "Add new tag" row, key/value autocomplete from taginfo, Enter/`=` moving between cells, a
  duplicate key jumping to the existing row, and a List/Text toggle (the current text view)
  remembered per browser. Mixed values in a multi-selection show "Multiple values".
- **Relations and members** ✔: parent relations with roles (role autocomplete from
  taginfo), adding the feature to a relation in view or to a new one, removing it; for a
  selected relation, its members with roles, zoom-to and reorder.
- **Multi-selection** ✔ (with P5.3's multi-select): "Features (N)" list, the fields the
  selected presets share, "Multiple values", edits applied to each feature in one undo step.
- **Hover preview** ✔: hovering a feature shows its editor read-only.
- **Services** ✔: taginfo (suggestions, debounced 300 ms and cached), Wikidata and Wikipedia
  (their fields), and the OSM wiki's Wikibase for ⓘ tag references (description, image,
  link) ✔. Their URLs go in `config.json`; e2e tests serve them from fixtures.
- **Undo**: one history step per field edit, as in iD. Text is applied when leaving the field
  until P5.2 lands, then live as you type ✔.

#### P5.2 Fast core (before anything is dragged)

- **Incremental map updates**: every edit rebuilds all features and re-sends them to the map
  (about 120 ms per edit on 10,000 rooms, so dragging would run at ~8 fps). Cache each
  feature by entity identity, work out the changed ids (plus ways and relations using
  changed nodes) and send only those with `updateData`. Make `@lv` independent of the levels
  in the whole dataset (or fall back to `setData` when they change), and draw drags on a
  small overlay source, committed on release.
- **Batched graph edits**: `replace`/`remove` copy all local edits and parent indexes are
  rebuilt per graph, so changing many entities is quadratic (deleting 1,000 rooms: 1.6 s).
  Add a batch API with a mutable draft frozen at the end.
- **Spatial index**: snapping walks every node in the graph; use `rbush` per level for
  snapping and hit-testing.
- Then switch the feature editor to live typing.

#### P5.3 Geometry editing

- Modes: browse, select/multi-select, drag node (moves every parent way), draw point, line, area;
  snapping (rbush, 8 px, current level only).
- Operations: add vertex at midpoint; delete with cleanup (keep POI and shared nodes, drop empty
  relations); door on wall; orthogonalize (port iD's current action); copy/paste features and
  tags; copy level.
- Building, Levels and Features workflows; simple multipolygons (outer + inner).
- Door widths and incline/conveying arrows on the map; incremental source updates on edit.
- Floor plans (from P4): snap control points to building outlines, numeric offset, assign
  plans to a building.
- Spatial validation (from P3): level outside the building's levels, missing `indoor=level`
  outline; empty keys or values.
- History autosaved to IndexedDB with a restore prompt and a `beforeunload` guard.

Later, nice to have: build floor plan pyramids on first display and in a worker (an
8192 × 8192 plan keeps about 360 MB of halved images today), and keep original image files
instead of re-encoding them as PNG.

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
