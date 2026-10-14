<script lang="ts">
	import { untrack } from "svelte";
	import { OsmApi } from "#lib/api/osm-api.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import { Editor } from "#lib/state/editor.svelte.ts";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	interface Props {
		config: EditorConfig;
	}

	let { config }: Props = $props();

	const fromUrl = parseHash(location.hash);
	// The configuration is read once: it doesn't change while the editor runs.
	const editor = untrack(
		() =>
			new Editor({
				api: new OsmApi({
					baseUrl: config.osm_api_url,
					getToken: () => null,
					createdBy: `IndoorID ${__GIT_HASH__}`,
				}),
				minZoom: config.data_min_zoom,
			}),
	);

	let map = $state.raw<MapLibreMap>();
	let indoor = $state.raw<IndoorMap>();
	let camera = $state.raw<Omit<View, "level">>();
	let level = $state(fromUrl?.level ?? 0);
	let lastHash = "";

	// The indoor layers live as long as the map.
	$effect(() => {
		if (!map) return;
		const layers = new IndoorMap(map);
		indoor = layers;
		return () => layers.remove();
	});
	$effect(() => indoor?.setData(editor.features.collection));
	$effect(() => indoor?.setLevel(level));

	// Keep the URL hash in sync with the map camera and the selected level.
	const hash = $derived(camera && formatHash({ ...camera, level }));
	$effect(() => {
		if (hash && hash !== lastHash) {
			lastHash = hash;
			void goto(resolve(hash), { replace: true, shallow: true });
		}
	});

	function onMove(next: Omit<View, "level">) {
		camera = next;
		const bounds = map?.getBounds();
		if (!bounds) return;
		void editor.loadView(
			{
				west: bounds.getWest(),
				south: bounds.getSouth(),
				east: bounds.getEast(),
				north: bounds.getNorth(),
			},
			next.zoom,
		);
	}

	// Follow hash edits made by the user (typed URL, pasted link, back/forward).
	function onHashChange() {
		if (location.hash === lastHash) return;
		const view = parseHash(location.hash);
		if (!view) return;
		level = view.level;
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
	}

	const statusMessage = $derived.by(() => {
		switch (editor.status.kind) {
			case "loading":
				return "Loading OpenStreetMap data…";
			case "zoom-in":
				return "Zoom in to see and edit indoor data";
			case "error":
				return `Some data could not be loaded (${editor.status.failed} area${editor.status.failed > 1 ? "s" : ""}). Move the map to retry.`;
			default:
				return null;
		}
	});
</script>

<svelte:window onhashchange={onHashChange} />

<MapView
	styleUrl={config.basemap_style}
	initialCamera={fromUrl ?? {
		zoom: config.map_initial_zoom,
		lat: config.map_initial_latlng[0],
		lon: config.map_initial_latlng[1],
	}}
	bind:map
	onmove={onMove}
/>

<div class="absolute top-4 right-4 z-10">
	<LevelControl bind:level levels={editor.features.levels} />
</div>

{#if statusMessage}
	<p
		role="status"
		data-testid="load-status"
		class={[
			"absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-1.5 text-sm shadow",
			editor.status.kind === "error"
				? "bg-amber-100 text-amber-900"
				: "bg-white/90 text-slate-700 dark:bg-slate-900/90 dark:text-slate-200",
		]}
	>
		{statusMessage}
	</p>
{/if}
