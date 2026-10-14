<script lang="ts">
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Upload from "@lucide/svelte/icons/upload";
	import { type Component, untrack } from "svelte";
	import type { Place } from "#lib/api/nominatim.ts";
	import type { Bbox } from "#lib/api/osm-api.ts";
	import { OsmApi } from "#lib/api/osm-api.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { setBackground } from "#lib/map/background.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import type { ImageryEntry } from "#lib/map/imagery.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
	import { Editor } from "#lib/state/editor.svelte.ts";
	import { Session } from "#lib/state/session.svelte.ts";
	import ImageryPicker from "#lib/ui/ImageryPicker.svelte";
	import Inspector from "#lib/ui/Inspector.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import SaveDialog from "#lib/ui/SaveDialog.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	interface Props {
		config: EditorConfig;
	}

	let { config }: Props = $props();

	const fromUrl = parseHash(location.hash);
	// The configuration is read once: it doesn't change while the editor runs.
	const { session, editor, websiteUrl } = untrack(() => {
		const websiteUrl = config.oauth_url ?? config.osm_api_url;
		const session = new Session({
			oauthUrl: websiteUrl,
			apiUrl: config.osm_api_url,
			clientId: config.oauth_client_id,
			redirectUri: new URL(resolve("/auth/callback"), location.href).href,
		});
		const api = new OsmApi({
			baseUrl: config.osm_api_url,
			getToken: () => session.token(),
			createdBy: `IndoorID ${__GIT_HASH__}`,
		});
		const editor = new Editor({ api, minZoom: config.data_min_zoom });
		return { session, editor, websiteUrl };
	});
	let saving = $state(false);

	let map = $state.raw<MapLibreMap>();
	let camera = $state.raw<Omit<View, "level">>();
	let level = $state(fromUrl?.level ?? 0);
	let lastHash = "";
	let background = $state.raw<ImageryEntry | null>(null);
	/** Imagery shown since the last upload, for the changeset's imagery_used tag. */
	let imageryUsed = $state<string[]>([]);

	function showBackground(entry: ImageryEntry | null) {
		background = entry;
		if (entry && !imageryUsed.includes(entry.name)) {
			imageryUsed = [...imageryUsed, entry.name];
		}
		if (map) setBackground(map, entry);
	}

	// The indoor layers live as long as the map, and follow the data and the selected level.
	$effect(() => {
		if (!map) return;
		const indoor = new IndoorMap(map);
		$effect(() => indoor.setData(editor.features.collection));
		$effect(() => indoor.setLevel(level));
		$effect(() => indoor.setSelected(editor.selectedId));
		const stopClicks = indoor.onClick((id) =>
			editor.select(id as EntityId | null),
		);
		return () => {
			stopClicks();
			indoor.remove();
		};
	});

	// Keep the URL hash in sync with the map camera and the selected level.
	const hash = $derived(camera && formatHash({ ...camera, level }));
	$effect(() => {
		if (hash && hash !== lastHash) {
			lastHash = hash;
			void goto(resolve(hash), { replace: true, shallow: true });
		}
	});

	function visibleArea(): Bbox | undefined {
		const bounds = map?.getBounds();
		return (
			bounds && {
				west: bounds.getWest(),
				south: bounds.getSouth(),
				east: bounds.getEast(),
				north: bounds.getNorth(),
			}
		);
	}

	function onMove(next: Omit<View, "level">) {
		camera = next;
		const area = visibleArea();
		if (area) void editor.loadView(area, next.zoom);
	}

	function showPlace(place: Place) {
		if (place.bbox) {
			const { west, south, east, north } = place.bbox;
			map?.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ maxZoom: 19, duration: 0 },
			);
		} else {
			map?.jumpTo({ center: [place.lon, place.lat], zoom: 19 });
		}
	}

	// Follow hash edits made by the user (typed URL, pasted link, back/forward).
	function onHashChange() {
		if (location.hash === lastHash) return;
		const view = parseHash(location.hash);
		if (!view) return;
		level = view.level;
		map?.jumpTo({ center: [view.lon, view.lat], zoom: view.zoom });
	}

	/** Undo/redo shortcuts, except while typing in a field (which has its own undo). */
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing = target?.closest("input, textarea, select") !== null;
		if (event.key === "Escape" && !typing) {
			editor.select(null);
			return;
		}
		if (typing || !(event.ctrlKey || event.metaKey)) return;
		const key = event.key.toLowerCase();
		if (key === "z" && !event.shiftKey) {
			event.preventDefault();
			editor.undo();
		} else if ((key === "z" && event.shiftKey) || key === "y") {
			event.preventDefault();
			editor.redo();
		}
	}

	const statusMessage = $derived.by(() => {
		switch (editor.status.kind) {
			case "loading":
				return "Loading OpenStreetMap data…";
			case "zoom-in":
				return "Zoom in to load indoor data here";
			case "error":
				return `Some data could not be loaded (${editor.status.failed} area${editor.status.failed > 1 ? "s" : ""}). Move the map to retry.`;
			default:
				return null;
		}
	});
</script>

<svelte:window onhashchange={onHashChange} onkeydown={onKeydown} />

{#snippet iconButton(
	label: string,
	hint: string,
	Icon: Component,
	disabled: boolean,
	onclick: () => void,
)}
	<Tooltip.Root>
		<Tooltip.Trigger {disabled} {onclick}>
			{#snippet child({
				props,
			})}
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={label}
					{disabled}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">{hint}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

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

<div class="absolute top-4 left-4 z-20 flex flex-col items-start gap-2">
	<SearchPlace
		getView={visibleArea}
		onselect={showPlace}
		baseUrl={config.nominatim_url}
	/>
	<!-- Map controls sit on an opaque surface: shadcn's dark outline styles are translucent. -->
	<div class="rounded-md bg-background shadow-md">
		<ButtonGroup.Root aria-label="Edit history">
			{@render iconButton("Undo", "Undo (Ctrl+Z)", Undo2, !editor.canUndo, () =>
				editor.undo(),
			)}
			{@render iconButton(
				"Redo",
				"Redo (Ctrl+Shift+Z)",
				Redo2,
				!editor.canRedo,
				() => editor.redo(),
			)}
			<Button
				variant="outline"
				disabled={editor.editCount === 0}
				onclick={() => (saving = true)}
			>
				<Upload data-icon="inline-start" />
				Save
				<Badge class="tabular-nums" data-testid="edit-count"
					>{editor.editCount}</Badge
				>
				<span class="sr-only">edits</span>
			</Button>
		</ButtonGroup.Root>
	</div>
	<ImageryPicker
		center={camera && [camera.lon, camera.lat]}
		selected={background?.id ?? null}
		onselect={showBackground}
		indexUrl={config.imagery_index_url}
	/>
</div>

<div
	class="absolute top-4 z-10"
	style:right={editor.selected ? "23rem" : "1rem"}
>
	<LevelControl bind:level levels={editor.features.levels} />
</div>

{#if editor.selected}
	<div class="absolute inset-y-0 right-0 z-30">
		<Inspector {editor} entity={editor.selected} />
	</div>
{/if}

{#if statusMessage}
	<p
		role="status"
		data-testid="load-status"
		class={[
			"absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-full bg-popover px-4 py-1.5 text-sm shadow-md ring-1 ring-foreground/10",
			editor.status.kind === "error"
				? "text-destructive"
				: "text-popover-foreground",
		]}
	>
		{statusMessage}
	</p>
{/if}

{#if saving}
	<SaveDialog
		{editor}
		{session}
		imagery={imageryUsed}
		{websiteUrl}
		onclose={() => (saving = false)}
	/>
{/if}
