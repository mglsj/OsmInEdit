/**
 * Draws floor plans on the map: one MapLibre image source and raster layer per plan tile, between
 * the background imagery and the indoor data. Plans are compared by identity, so only what
 * changed is updated: moving a plan sets new coordinates, it never re-uploads the image.
 */
import { tileCorners } from "#lib/floorplans/tiling.ts";
import type { FloorPlan } from "#lib/state/floorplans.svelte.ts";
import type { ImageSource, Map as MapLibreMap } from "./maplibre.ts";

/** Prefix of the floor plan source and layer ids. */
export const FLOORPLAN_PREFIX = "floorplan-";

interface Shown {
	readonly plan: FloorPlan;
	readonly ids: readonly string[];
}

export class FloorPlanLayers {
	readonly #map: MapLibreMap;
	#ready = false;
	#plans: readonly FloorPlan[] = [];
	readonly #shown = new Map<string, Shown>();

	constructor(map: MapLibreMap) {
		this.#map = map;
		const install = () => {
			this.#ready = true;
			this.#sync();
		};
		if (map.isStyleLoaded()) install();
		else map.once("load", install);
	}

	/** Shows these plans, the last one on top. */
	setPlans(plans: readonly FloorPlan[]): void {
		this.#plans = plans;
		if (this.#ready) this.#sync();
	}

	remove(): void {
		for (const id of [...this.#shown.keys()]) this.#hide(id);
	}

	#sync(): void {
		const wanted = this.#plans.filter((p) => p.visible);
		const wantedIds = new Set(wanted.map((p) => p.id));
		for (const [id, shown] of this.#shown) {
			if (!wantedIds.has(id) || shown.plan.image !== this.#find(id)?.image) {
				this.#hide(id);
			}
		}
		for (const plan of wanted) {
			const shown = this.#shown.get(plan.id);
			if (!shown) this.#show(plan);
			else if (shown.plan !== plan) this.#update(shown, plan);
		}
		// Keep the plans' order: each one moved below the indoor data, in turn.
		for (const plan of wanted) {
			for (const id of this.#shown.get(plan.id)?.ids ?? []) {
				this.#map.moveLayer(id, this.#below());
			}
		}
	}

	#find(id: string): FloorPlan | undefined {
		return this.#plans.find((p) => p.id === id);
	}

	#show(plan: FloorPlan): void {
		const ids = plan.image.tiles.map(({ tile, bitmap }, i) => {
			const id = `${FLOORPLAN_PREFIX}${plan.id}-${i}`;
			this.#map.addSource(id, {
				type: "image",
				coordinates: tileCorners(plan.transform, tile),
			});
			const source = this.#map.getSource<ImageSource>(id);
			source?.setWarp("perspective");
			source?.updateImage({ image: bitmap });
			this.#map.addLayer(
				{
					id,
					type: "raster",
					source: id,
					paint: { "raster-opacity": plan.opacity, "raster-fade-duration": 0 },
				},
				this.#below(),
			);
			return id;
		});
		this.#shown.set(plan.id, { plan, ids });
	}

	#update(shown: Shown, plan: FloorPlan): void {
		if (plan.transform !== shown.plan.transform) {
			plan.image.tiles.forEach(({ tile }, i) => {
				const id = shown.ids[i];
				if (!id) return;
				this.#map
					.getSource<ImageSource>(id)
					?.setCoordinates(tileCorners(plan.transform, tile));
			});
		}
		if (plan.opacity !== shown.plan.opacity) {
			for (const id of shown.ids) {
				this.#map.setPaintProperty(id, "raster-opacity", plan.opacity);
			}
		}
		this.#shown.set(plan.id, { plan, ids: shown.ids });
	}

	#hide(id: string): void {
		for (const layer of this.#shown.get(id)?.ids ?? []) {
			if (this.#map.getLayer(layer)) this.#map.removeLayer(layer);
			if (this.#map.getSource(layer)) this.#map.removeSource(layer);
		}
		this.#shown.delete(id);
	}

	/** The layer plans go below: the indoor data, or else the basemap labels. */
	#below(): string | undefined {
		return this.#map.getLayer("indoor-fill")
			? "indoor-fill"
			: this.#map.getStyle().layers.find((l) => l.type === "symbol")?.id;
	}
}
