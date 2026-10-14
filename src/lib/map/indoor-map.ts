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
import { INDOOR_SOURCE, indoorLayers } from "./style/layers.ts";

type Collection = FeatureCollection<Geometry, FeatureProperties>;

/** Layers drawn above the basemap's labels; the others go below them. */
const ABOVE_LABELS = new Set(["indoor-doors", "indoor-labels"]);

export class IndoorMap {
	readonly #map: MapLibreMap;
	#ready = false;
	#data: Collection = { type: "FeatureCollection", features: [] };
	#level = 0;

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
	}

	#source(): GeoJSONSource | undefined {
		return this.#map.getSource<GeoJSONSource>(INDOOR_SOURCE);
	}
}
