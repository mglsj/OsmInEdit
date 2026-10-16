/**
 * Owns the indoor source and layers on a MapLibre map. Data and level can be set before the
 * basemap style has loaded; they are applied once it is ready.
 */
import { BUILDING_COLOR } from "#lib/floorplans/colors.ts";
import { diffFeatures, type StoredFeatures } from "./feature-store.ts";
import type { IndoorFeature } from "./features.ts";
import type {
	FilterSpecification,
	GeoJSONSource,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { styleReady } from "./ready.ts";
import { loadIconsOnDemand } from "./style/icons.ts";
import {
	INDOOR_SOURCE,
	indoorLayers,
	SELECTABLE_LAYER_IDS,
} from "./style/layers.ts";

/** Layers drawn above the basemap's labels; the others go below them. */
const ABOVE_LABELS = new Set([
	"indoor-doors",
	"indoor-labels",
	"indoor-selection-line",
	"indoor-selection-point",
]);

/** Outlines of the buildings, drawn only in floor plan mode to place plans against. */
export const BUILDINGS_LAYER = "indoor-buildings";
/** Magenta stands out on plans and imagery; plans' own colours stay clear of it. */
const BUILDING_OUTLINE = BUILDING_COLOR;

/** Click tolerance, in pixels around the pointer. */
const CLICK_TOLERANCE = 4;

export class IndoorMap {
	readonly #map: MapLibreMap;
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;
	/** The features last given, and those the source holds (by entity id). */
	#features: StoredFeatures | null = null;
	#sent = new Map<string, IndoorFeature>();
	#level = 0;
	#selected: string | null = null;
	#planMode = false;
	#buildingsVisible = true;

	constructor(map: MapLibreMap) {
		this.#map = map;
		loadIconsOnDemand(map);
		void styleReady(map).then(() => {
			if (!this.#removed) this.#install();
		});
	}

	/**
	 * Shows these features, sending the source only the features that changed since the last
	 * call (`updateData`), or all of them when most changed (new levels encode them all again).
	 */
	setFeatures(features: StoredFeatures): void {
		this.#features = features;
		if (!this.#ready) return;
		const source = this.#source();
		if (!source) return;
		const { add, remove } = diffFeatures(this.#sent, features.byId);
		if (add.length + remove.length === 0) return;
		if (add.length + remove.length > features.byId.size / 2) {
			void source.setData(features.collection);
			this.#sent = new Map(features.byId);
			return;
		}
		void source.updateData({ add, remove });
		for (const id of remove) this.#sent.delete(id);
		for (const feature of add)
			this.#sent.set(feature.properties["@id"], feature);
	}

	/** Shows another level: only the layers' filters change, the data stays. */
	setLevel(level: number): void {
		this.#level = level;
		if (!this.#ready) return;
		for (const layer of indoorLayers(level)) {
			if ("filter" in layer && layer.filter) {
				this.#map.setFilter(layer.id, layer.filter as FilterSpecification);
			}
		}
	}

	/**
	 * Floor plan mode: only the buildings' outlines are drawn, as a reference to place plans
	 * against; rooms, icons, labels and the selection are hidden.
	 */
	setPlanMode(on: boolean): void {
		this.#planMode = on;
		if (this.#ready) this.#applyPlanMode();
	}

	/** Whether floor plan mode shows the building outlines. */
	setBuildingsVisible(visible: boolean): void {
		this.#buildingsVisible = visible;
		if (this.#ready) this.#applyPlanMode();
	}

	#applyPlanMode(): void {
		const visibility = (shown: boolean) => (shown ? "visible" : "none");
		for (const layer of indoorLayers(this.#level)) {
			this.#map.setLayoutProperty(
				layer.id,
				"visibility",
				visibility(!this.#planMode),
			);
		}
		this.#map.setLayoutProperty(
			BUILDINGS_LAYER,
			"visibility",
			visibility(this.#planMode && this.#buildingsVisible),
		);
	}

	/** Highlights a feature, by `@id`, or nothing. */
	setSelected(id: string | null): void {
		if (this.#ready && this.#selected !== null) {
			this.#map.setFeatureState(
				{ source: INDOOR_SOURCE, id: this.#selected },
				{ selected: false },
			);
		}
		this.#selected = id;
		if (this.#ready && id !== null) {
			this.#map.setFeatureState(
				{ source: INDOOR_SOURCE, id },
				{ selected: true },
			);
		}
	}

	/**
	 * Calls `handler` with the `@id` of the clicked feature, topmost first, or null for a click
	 * on empty space. Returns a function removing the handler.
	 */
	onClick(handler: (id: string | null) => void): () => void {
		const map = this.#map;
		const listener = ({ point }: { point: { x: number; y: number } }) => {
			const features = this.#ready
				? map.queryRenderedFeatures(
						[
							[point.x - CLICK_TOLERANCE, point.y - CLICK_TOLERANCE],
							[point.x + CLICK_TOLERANCE, point.y + CLICK_TOLERANCE],
						],
						{ layers: SELECTABLE_LAYER_IDS },
					)
				: [];
			const id = features[0]?.properties["@id"];
			handler(typeof id === "string" ? id : null);
		};
		const pointer = () => (map.getCanvas().style.cursor = "pointer");
		const reset = () => (map.getCanvas().style.cursor = "");
		map.on("click", listener);
		for (const layer of SELECTABLE_LAYER_IDS) {
			map.on("mouseenter", layer, pointer);
			map.on("mouseleave", layer, reset);
		}
		return () => {
			map.off("click", listener);
			for (const layer of SELECTABLE_LAYER_IDS) {
				map.off("mouseenter", layer, pointer);
				map.off("mouseleave", layer, reset);
			}
		};
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const { id } of [
			...indoorLayers(this.#level),
			{ id: BUILDINGS_LAYER },
		]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(INDOOR_SOURCE))
			this.#map.removeSource(INDOOR_SOURCE);
		this.#ready = false;
	}

	#install(): void {
		const map = this.#map;
		const firstLabel = map
			.getStyle()
			.layers.find((l) => l.type === "symbol")?.id;
		map.addSource(INDOOR_SOURCE, {
			type: "geojson",
			data: this.#features?.collection ?? {
				type: "FeatureCollection",
				features: [],
			},
			promoteId: "@id",
		});
		this.#sent = new Map(this.#features?.byId ?? []);
		for (const layer of indoorLayers(this.#level)) {
			map.addLayer(layer, ABOVE_LABELS.has(layer.id) ? undefined : firstLabel);
		}
		map.addLayer({
			id: BUILDINGS_LAYER,
			type: "line",
			source: INDOOR_SOURCE,
			filter: ["has", "@building"],
			layout: { visibility: "none" },
			paint: { "line-color": BUILDING_OUTLINE, "line-width": 3 },
		});
		this.#ready = true;
		this.#applyPlanMode();
		this.setSelected(this.#selected);
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(INDOOR_SOURCE);
	}
}
