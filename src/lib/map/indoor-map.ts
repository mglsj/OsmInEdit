/**
 * Owns the indoor source and layers on a MapLibre map. Data and level can be set before the
 * basemap style has loaded; they are applied once it is ready.
 */
import type { FeatureCollection, Geometry } from "geojson";
import type { FeatureProperties } from "./features.ts";
import type {
	FilterSpecification,
	GeoJSONSource,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { loadIconsOnDemand } from "./style/icons.ts";
import {
	INDOOR_SOURCE,
	indoorLayers,
	SELECTABLE_LAYER_IDS,
} from "./style/layers.ts";

type Collection = FeatureCollection<Geometry, FeatureProperties>;

/** Layers drawn above the basemap's labels; the others go below them. */
const ABOVE_LABELS = new Set([
	"indoor-doors",
	"indoor-labels",
	"indoor-selection-line",
	"indoor-selection-point",
]);

/** Click tolerance, in pixels around the pointer. */
const CLICK_TOLERANCE = 4;

export class IndoorMap {
	readonly #map: MapLibreMap;
	#ready = false;
	#data: Collection = { type: "FeatureCollection", features: [] };
	#level = 0;
	#selected: string | null = null;

	constructor(map: MapLibreMap) {
		this.#map = map;
		loadIconsOnDemand(map);
		if (map.isStyleLoaded()) this.#install();
		else map.once("load", () => this.#install());
	}

	setData(data: Collection): void {
		this.#data = data;
		if (this.#ready) this.#source()?.setData(data);
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
		if (!this.#ready) return;
		for (const layer of indoorLayers(this.#level)) {
			if (this.#map.getLayer(layer.id)) this.#map.removeLayer(layer.id);
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
			data: this.#data,
			promoteId: "@id",
		});
		for (const layer of indoorLayers(this.#level)) {
			map.addLayer(layer, ABOVE_LABELS.has(layer.id) ? undefined : firstLabel);
		}
		this.#ready = true;
		this.setSelected(this.#selected);
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(INDOOR_SOURCE);
	}
}
