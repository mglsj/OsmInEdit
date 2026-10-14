# CLAUDE.md

Indoor OpenStreetMap editor: a rewrite of OsmInEdit (React + Leaflet, 2019) as a client-only
SvelteKit + MapLibre app. OSM is the only backend. The roadmap, decisions and phase status live in
[plan.md](plan.md): read it before starting a phase and update its status when a phase lands.

## Commands

Bun is the package manager and script runner; Node 26 runs Vite and the test tools.

```bash
bun install
bun run dev          # http://localhost:5173
bun run check        # svelte-check (types)
bun run lint         # Biome: format + lint (bun run format to fix)
bun run test:unit    # Vitest, *.test.ts next to the code
bun run test:e2e     # builds, then Playwright from tests/e2e
```

Before pushing, run `lint`, `check`, `test:unit` and `test:e2e`. CI (`.github/workflows/ci.yml`)
runs the same commands.

## Stack and layout

- Svelte 5 (runes only), SvelteKit 3 with `adapter-static`; every route is `ssr = false`,
  `prerender = true` (empty shell, rendered in the browser).
- MapLibre GL JS 6, Tailwind CSS 4, bits-ui (headless components), `@lucide/svelte` icons.
- `src/lib/` holds the code, imported as `#lib/...` with explicit extensions
  (`import { parseHash } from "#lib/map/hash.ts"`). `$lib` does not exist in SvelteKit 3.
- `src/lib/ui/` components, `src/lib/map/` map helpers, `src/routes/` pages, `static/` copied
  as-is (`config.json`, legacy icons in `static/img`), `tests/e2e/` browser tests.
- Planned modules (see plan.md): `osm`, `actions`, `levels`, `api`, `presets`, `validation`,
  `edit`, `floorplans`, `persist`, `state`. Pure modules (`osm`, `levels`, `actions`, `presets`,
  `validation`, `floorplans/georef`) must not touch the DOM or Svelte.

## Rules that are easy to get wrong

- **MapLibre**: import it only from `#lib/map/maplibre.ts`, never from `maplibre-gl`. That module
  calls `setWorkerUrl()`; without it MapLibre 6 under Vite loads no data source at all (a
  background-only style still renders, so the failure is easy to miss). v6 has no default
  export: use named imports. Load the `maplibre-v6-migration` skill before using APIs you know
  from v5.
- **SvelteKit 3**: config lives in `vite.config.ts` (`sveltekit({...})`); there is no
  `svelte.config.js`. `asset()` takes paths without a leading slash (`asset("config.json")`).
  Use `goto(resolve(hash), { replace: true, shallow: true })` instead of `history.replaceState`.
- **Svelte**: integrate imperative libraries with `{@attach}` (see `MapView.svelte`), keep large
  data (the OSM graph, GeoJSON) in `$state.raw` and replace it immutably, prefer `$derived` over
  effects, and only use `$effect` to sync to the outside world.
- **Config**: `static/config.json` is public. Never put secrets or API keys in it or in the code.
- **OSM data**: never rewrite a tag the user didn't edit (the legacy editor silently rewrote
  `level`). Level values are strings like `0;1`, `-1`, `0.5`, `1-3`; level `0` is a real level,
  never treat it as falsy. Uploads are one atomic osmChange, built from the graph difference.
- **Formatting**: Biome (tabs, double quotes) formats `.ts`, `.svelte`, `.css` and `.json`. Don't
  hand-format; run `bun run format`.

## Tests

- Follow the `tdd` skill: agree on the seams to test first, then red → green, one slice at a time.
  Expected values come from the spec or worked examples, never recomputed like the code does.
- Unit tests sit next to the module (`hash.ts` → `hash.test.ts`) and test public functions.
- E2E tests use the `test` fixture from `tests/e2e/fixtures.ts`: it blocks all external requests
  and serves a blank basemap style. Override a route in the test when you need specific data.
  `camera()` reads the map's camera, `pixelAt()` checks rendered colours (WebGL runs in
  SwiftShader).
- `@playwright/test` is pinned to 1.56.1 because that version matches the Chromium preinstalled in
  cloud sessions (`/opt/pw-browsers`). Upgrade both together.

## Skills in `.claude/skills`

Installed with a skills manager (`skills-lock.json`); don't edit them by hand.

| Task                                                   | Skill                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Writing or reviewing any `.svelte` / `.svelte.ts` file | `svelte-core-bestpractices`, then `svelte-code-writer`   |
| Anything MapLibre 6 (APIs, events, worker, imports)    | `maplibre-v6-migration`                                  |
| Map styling: indoor layers, labels, icons, ordering    | `maplibre-cartography`, `maplibre-fonts-glyphs`          |
| Sources not rendering, `promoteId`, feature state      | `maplibre-source-wiring`, `maplibre-tile-sources`        |
| Hosting tiles statically (if ever needed)              | `maplibre-pmtiles-patterns`                              |
| UI tokens and components with Tailwind 4               | `tailwind-design-system`                                 |
| UI / accessibility review                              | `web-design-guidelines`                                  |
| Test-first work                                        | `tdd`                                                    |
| Typed graph / tag / preset models                      | `typescript-advanced-types`, `modern-javascript-patterns` |

Not relevant to this app: `maplibre-terrain-rendering`, `maplibre-running-evals`,
`maplibre-skill-authoring` (the last two are for authoring MapLibre's own skills).

## Tools and MCP

No MCP server is configured in the repo. The Svelte tooling from `svelte-code-writer` runs as a
CLI:

```bash
npx @sveltejs/mcp list-sections
npx @sveltejs/mcp get-documentation "$state,$derived"
npx @sveltejs/mcp svelte-autofixer ./src/lib/ui/MapView.svelte --svelte-version 5
```

Pass `--svelte-version 5` (a full version like `5.57.2` is rejected). In cloud sessions, Node's
`fetch` ignores the HTTPS proxy: prefix these commands with `NODE_USE_ENV_PROXY=1`. When the
MDN MCP server is available, use it for web platform APIs (WebGL limits, OffscreenCanvas,
IndexedDB, File System Access).

Cloud sessions run `.claude/hooks/session-start.sh` (`bun install`) at startup.

## Reference: the legacy editor

The 1.x code is on `master` history before the rewrite (commit `cd1e955`, tag `legacy-v1.0.16`
once pushed). Useful files to port behaviour from, via `git show cd1e955:<path>`:
`src/ctrl/VectorDataManager.js` (level logic, diff scenarios), its `.test.js`,
`public/style.mapcss` (visual language), `public/presets/indoor.xml`,
`src/ctrl/ImageryManager.js`, `src/config/locales/`.
