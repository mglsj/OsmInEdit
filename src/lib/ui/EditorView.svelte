<script lang="ts">
	import FileImage from "@lucide/svelte/icons/file-image";
	import Redo2 from "@lucide/svelte/icons/redo-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import Upload from "@lucide/svelte/icons/upload";
	import { type Component, untrack } from "svelte";
	import type { Place } from "#lib/api/nominatim.ts";
	import type { Bbox } from "#lib/api/osm-api.ts";
	import { OsmApi } from "#lib/api/osm-api.ts";
	import { OsmWikibase } from "#lib/api/osm-wikibase.ts";
	import { Taginfo } from "#lib/api/taginfo.ts";
	import { searchWikipedia, Wikidata } from "#lib/api/wikidata.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { EditorConfig } from "#lib/config.ts";
	import { groundDistance, type LngLat } from "#lib/floorplans/georef.ts";
	import { importRaster } from "#lib/floorplans/import.ts";
	import { setBackground } from "#lib/map/background.ts";
	import {
		FloorPlanLayers,
		PlanToolLayer,
		planFrames,
		toolFeatures,
	} from "#lib/map/floorplan-layers.ts";
	import {
		formatHash,
		parseHash,
		type MapView as View,
	} from "#lib/map/hash.ts";
	import type { ImageryEntry } from "#lib/map/imagery.ts";
	import { IndoorMap } from "#lib/map/indoor-map.ts";
	import {
		LngLat as LngLatClass,
		type LngLatLike,
		type Map as MapLibreMap,
		type MapMouseEvent,
	} from "#lib/map/maplibre.ts";
	import { PlanDragging } from "#lib/map/plan-dragging.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
	import { IndexedDbPlanStore } from "#lib/persist/plan-store.ts";
	import { Editor } from "#lib/state/editor.svelte.ts";
	import {
		FloorPlans,
		type View as PlanView,
	} from "#lib/state/floorplans.svelte.ts";
	import { Session } from "#lib/state/session.svelte.ts";
	import FloorPlansPanel from "#lib/ui/FloorPlansPanel.svelte";
	import ImageryPicker from "#lib/ui/ImageryPicker.svelte";
	import Inspector from "#lib/ui/Inspector.svelte";
	import LevelControl from "#lib/ui/LevelControl.svelte";
	import MapView from "#lib/ui/MapView.svelte";
	import SaveDialog from "#lib/ui/SaveDialog.svelte";
	import SearchPlace from "#lib/ui/SearchPlace.svelte";
	import UnsavedPlanDialog from "#lib/ui/UnsavedPlanDialog.svelte";
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
		const editor = new Editor({
			api,
			minZoom: config.data_min_zoom,
			taginfo: new Taginfo({ baseUrl: config.taginfo_url }),
			wikibase: new OsmWikibase({ baseUrl: config.osm_wiki_api_url }),
			wikidata: new Wikidata({ baseUrl: config.wikidata_api_url }),
			searchWikipedia: (lang, query) =>
				searchWikipedia(lang, query, { template: config.wikipedia_api_url }),
		});
		return { session, editor, websiteUrl };
	});
	let saving = $state(false);
	// Plans saved in earlier visits come back once their images are decoded.
	/**
	 * Floor plan mode: the map only shows building outlines to place plans against, and OSM
	 * features can't be selected or edited.
	 */
	let planMode = $state(false);

	function setPlanMode(on: boolean) {
		planMode = on;
		if (on) editor.select(null);
		// Locks the plan in Edit: callers ask first about unsaved changes (closePlanMode).
		else floorplans.cancel();
	}

	/** Leaves floor plan mode, once unsaved changes to the plan in Edit are saved or dropped. */
	function closePlanMode() {
		floorplans.whenSaved(() => setPlanMode(false));
	}

	const floorplans = new FloorPlans({
		store: new IndexedDbPlanStore(),
		decode: importRaster,
	});
	void floorplans.restore();
	/** Where map controls start when the side panel (22rem wide) is open. */
	const SIDE_PANEL_OFFSET = "23rem";
	/** Snapping distance for alignment clicks, in screen pixels. */
	const SNAP_DISTANCE = 8;

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
		$effect(() => indoor.setPlanMode(planMode));
		$effect(() => indoor.setBuildingsVisible(floorplans.buildings.visible));
		const stopClicks = indoor.onClick((id) => {
			// While aligning a floor plan, clicks go to the alignment tool.
			if (!planMode) editor.select(id as EntityId | null);
		});
		return () => {
			stopClicks();
			indoor.remove();
		};
	});

	// Floor plans are drawn as long as the map lives.
	$effect(() => {
		const instance = map;
		if (!instance) return;
		const layers = new FloorPlanLayers(instance);
		const marks = new PlanToolLayer(instance);
		$effect(() => layers.setLayers(floorplans.layers));
		$effect(() => layers.setLevel(level));
		// Frames tell the plans apart in floor plan mode; tool marks show whenever a tool is on.
		$effect(() => {
			const frames = planMode
				? planFrames(floorplans.plans, level).features
				: [];
			const tools = toolFeatures(
				floorplans.editing,
				floorplans.tool,
				planMode,
				pointer,
			).features;
			marks.setData({
				type: "FeatureCollection",
				features: [...frames, ...tools],
			});
		});
		// In floor plan mode, the selected plan can be dragged (unless a tool takes the clicks).
		const dragging = new PlanDragging(instance, {
			plan: () =>
				planMode && !floorplans.tool && floorplans.editing?.visible
					? floorplans.editing
					: null,
			onmove: (id, transform) => floorplans.preview(id, transform),
			onend: (id) => floorplans.commitPlacement(id),
		});
		const onClick = (event: MapMouseEvent) => {
			if (!floorplans.tool) return;
			toolMessage = floorplans.click(snap(event.point, event.lngLat));
		};
		// The measure line follows the pointer from the first spot.
		const onPointer = (event: MapMouseEvent) => {
			const tool = floorplans.tool;
			const following = tool?.kind === "measure" && tool.points.length === 1;
			if (following) pointer = [event.lngLat.lng, event.lngLat.lat];
			else if (pointer) pointer = null;
		};
		const onLeave = () => (pointer = null);
		instance.on("click", onClick);
		instance.on("mousemove", onPointer);
		instance.on("mouseout", onLeave);
		// On the canvas itself: MapLibre's own cursor rule on its container wins over a class.
		// Reset whenever what can be dragged changes: plan dragging sets it again on the next move.
		$effect(() => {
			const tool = floorplans.tool;
			void [floorplans.editingId, planMode];
			instance.getCanvas().style.cursor = tool ? "crosshair" : "";
		});
		return () => {
			instance.off("click", onClick);
			instance.off("mousemove", onPointer);
			instance.off("mouseout", onLeave);
			dragging.remove();
			marks.remove();
			layers.remove();
		};
	});

	/** Message from the alignment tool about the last click. */
	let toolMessage = $state<string | null>(null);
	/** Where the pointer is on the map, while the measure line follows it. */
	let pointer = $state.raw<LngLat | null>(null);

	/**
	 * A clicked position, moved onto the OSM node drawn within 8 px of it, if any: control points
	 * then sit exactly on the mapped walls and corners.
	 */
	function snap(point: { x: number; y: number }, lngLat: LngLatLike): LngLat {
		const { lng, lat } = LngLatClass.convert(lngLat);
		let best: LngLat = [lng, lat];
		let bestDistance = SNAP_DISTANCE;
		if (!map) return best;
		for (const entity of editor.graph.entities()) {
			if (entity.type !== "node") continue;
			const screen = map.project(entity.loc as [number, number]);
			const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = [entity.loc[0], entity.loc[1]];
			}
		}
		return best;
	}

	/** The side panel, which covers the left of the map while it is open. */
	let sidePanel = $state<HTMLElement>();

	/** The part of the map the side panel leaves visible, for placing new floor plans. */
	function planView(): PlanView | undefined {
		if (!map) return undefined;
		const { clientWidth, clientHeight } = map.getContainer();
		const left = sidePanel?.offsetWidth ?? 0;
		const { lng, lat } = map.unproject([
			(left + clientWidth) / 2,
			clientHeight / 2,
		]);
		const bounds = map.getBounds();
		return {
			center: [lng, lat],
			heightMetres: groundDistance(
				[lng, bounds.getNorth()],
				[lng, bounds.getSouth()],
			),
		};
	}

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
		// The unsaved changes dialog handles its own keys.
		if (floorplans.confirming) return;
		if (event.key === "Escape" && !typing) {
			if (floorplans.tool) floorplans.setTool(null);
			else if (planMode) closePlanMode();
			else editor.select(null);
			return;
		}
		// OSM edits can't be seen in floor plan mode: don't undo them blindly.
		if (typing || planMode || !(event.ctrlKey || event.metaKey)) return;
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

<!-- The side panel edits the selected feature, or the floor plans in floor plan mode. -->
{#if editor.selected || planMode}
	<div bind:this={sidePanel} class="absolute inset-y-0 left-0 z-30">
		{#if editor.selected}
			{#key editor.selected.id}
				<Inspector {editor} entity={editor.selected} {websiteUrl} />
			{/key}
		{:else}
			<FloorPlansPanel
				{floorplans}
				getView={planView}
				{level}
				{toolMessage}
				onclose={closePlanMode}
				onshowlevel={(shown) => (level = shown)}
			/>
		{/if}
	</div>
{/if}

<div
	class="absolute top-4 z-20 flex flex-col items-start gap-2"
	style:left={editor.selected || planMode ? SIDE_PANEL_OFFSET : "1rem"}
>
	<SearchPlace
		getView={visibleArea}
		onselect={showPlace}
		baseUrl={config.nominatim_url}
	/>
	{#if !planMode}
		<!-- Map controls sit on an opaque surface: shadcn's dark outline styles are translucent. -->
		<div class="rounded-md bg-background shadow-md">
			<ButtonGroup.Root aria-label="Edit history">
				{@render iconButton(
					"Undo",
					"Undo (Ctrl+Z)",
					Undo2,
					!editor.canUndo,
					() => editor.undo(),
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
	{/if}
	<ImageryPicker
		center={camera && [camera.lon, camera.lat]}
		selected={background?.id ?? null}
		onselect={showBackground}
		indexUrl={config.imagery_index_url}
	/>
	<div class="rounded-md bg-background shadow-md">
		<Button
			variant={planMode ? "secondary" : "outline"}
			aria-pressed={planMode}
			onclick={() => (planMode ? closePlanMode() : setPlanMode(true))}
		>
			<FileImage data-icon="inline-start" />
			Floor plans
		</Button>
	</div>
</div>

<div class="absolute top-4 right-4 z-10">
	<LevelControl bind:level levels={editor.features.levels} />
</div>

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

<UnsavedPlanDialog {floorplans} />
