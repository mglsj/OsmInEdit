/**
 * Editor state shared by the UI: the OSM graph with its history, the features drawn on the
 * map, and the loading status of the visible area.
 */
import { MapLoader } from "#lib/api/map-loader.ts";
import type { Bbox, OsmApi } from "#lib/api/osm-api.ts";
import { buildFeatures } from "#lib/map/features.ts";
import { AVAILABLE_ICONS } from "#lib/map/style/icons.ts";
import type { Entity } from "#lib/osm/entity.ts";
import { Graph } from "#lib/osm/graph.ts";
import { History } from "#lib/osm/history.ts";

export type LoadStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	/** The view is too zoomed out to download data. */
	| { readonly kind: "zoom-in" }
	/** Some tiles failed; they are retried on the next move. */
	| { readonly kind: "error"; readonly failed: number };

export interface EditorOptions {
	readonly api: Pick<OsmApi, "loadMap">;
	/** Data is only downloaded from this zoom level. */
	readonly minZoom: number;
}

export class Editor {
	/** Current graph; replaced (never mutated) on every change. */
	graph = $state.raw(Graph.fromEntities([]));
	status = $state.raw<LoadStatus>({ kind: "idle" });
	readonly features = $derived(
		buildFeatures(this.graph, { icons: AVAILABLE_ICONS }),
	);

	readonly #history = new History(this.graph);
	readonly #loader: MapLoader;
	readonly #minZoom: number;
	#loads = 0;

	constructor({ api, minZoom }: EditorOptions) {
		this.#minZoom = minZoom;
		this.#loader = new MapLoader({
			download: (bbox) => api.loadMap(bbox),
			onData: (entities) => this.#receive(entities),
		});
	}

	/** Downloads the data of the visible area, if zoomed in enough. */
	async loadView(bounds: Bbox, zoom: number): Promise<void> {
		if (zoom < this.#minZoom) {
			this.status = { kind: "zoom-in" };
			return;
		}
		this.#loads++;
		this.status = { kind: "loading" };
		const result = await this.#loader.load(bounds);
		this.#loads--;
		if (result.failed > 0) {
			this.status = { kind: "error", failed: result.failed };
		} else if (this.#loads === 0) {
			this.status = { kind: result.skipped ? "zoom-in" : "idle" };
		}
	}

	#receive(entities: Entity[]): void {
		this.#history.merge(entities);
		this.graph = this.#history.graph;
	}
}
