<script lang="ts">
	import { loadConfig } from "#lib/config.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const configPromise = loadConfig();
	const fromUrl = parseHash(location.hash);

	let map = $state.raw<MapLibreMap>();
	let camera = $state.raw<Omit<View, "level">>();
	let level = $state(fromUrl?.level ?? 0);
	let lastHash = "";

	// Keep the URL hash in sync with the map camera and the selected level.
	const hash = $derived(camera && formatHash({ ...camera, level }));
	$effect(() => {
		if (hash && hash !== lastHash) {
			lastHash = hash;
			void goto(resolve(hash), { replace: true, shallow: true });
		}
	});

	// Follow hash edits made by the user (typed URL, pasted link, back/forward).
	function onHashChange() {
		if (location.hash === lastHash) return;
		const view = parseHash(location.hash);
		if (!view) return;
		level = view.level;
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
	}
</script>

<svelte:window onhashchange={onHashChange} />

<div class="flex h-full flex-col">
	<header
		class="flex h-12 shrink-0 items-center gap-3 border-b border-black/10 px-4 dark:border-white/15"
	>
		<h1 class="text-base font-semibold">IndoorID</h1>
		<span class="text-xs text-slate-500 dark:text-slate-400"
			>2.0 preview · {__GIT_HASH__}</span
		>
	</header>

	<main class="relative min-h-0 flex-1">
		{#await configPromise}
			<p class="p-4 text-sm text-slate-500">Loading…</p>
		{:then config}
			<MapView
				styleUrl={config.basemap_style}
				initialCamera={fromUrl ?? {
					zoom: config.map_initial_zoom,
					lat: config.map_initial_latlng[0],
					lon: config.map_initial_latlng[1],
				}}
				bind:map
				onmove={(c) => (camera = c)}
			/>
			<div class="absolute top-4 right-4 z-10">
				<LevelControl bind:level />
			</div>
		{:catch error}
			<p role="alert" class="p-4 text-sm text-red-700 dark:text-red-300">
				{error.message}
			</p>
		{/await}
	</main>
</div>
