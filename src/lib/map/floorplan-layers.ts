/**
 * Draws floor plans on the map: one MapLibre image source and raster layer per plan tile, between
 * the background imagery and the indoor data. Plans are compared by identity, so only what
 * changed is updated: moving a plan sets new coordinates, it never re-uploads the image.
 */
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { type LngLat, type Pixel, project } from "#lib/floorplans/georef.ts";
import { tileCorners } from "#lib/floorplans/tiling.ts";
import { isOnLevel, parseLevels } from "#lib/levels/levels.ts";
import type { FloorPlan, Tool } from "#lib/state/floorplans.svelte.ts";
import type {
	GeoJSONSource,
	ImageSource,
	Map as MapLibreMap,
} from "./maplibre.ts";

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
	#level = 0;
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

	/** Shows only the plans of this level, and those not assigned to any. */
	setLevel(level: number): void {
		this.#level = level;
		if (this.#ready) this.#sync();
	}

	remove(): void {
		for (const id of [...this.#shown.keys()]) this.#hide(id);
	}

	#sync(): void {
		const wanted = this.#plans.filter(
			(p) => p.visible && isPlanOnLevel(p, this.#level),
		);
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

const TOOL_SOURCE = "floorplan-tool";

/** Marks of the alignment tools: control points, measured spots, the rotation pin. */
export function toolFeatures(
	plan: FloorPlan | null,
	tool: Tool | null,
): FeatureCollection<Point | LineString> {
	const features: Feature<Point | LineString>[] = [];
	const point = (position: LngLat, role: string, label = "") =>
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: position },
			properties: { role, label },
		});
	const line = (from: LngLat, to: LngLat) =>
		features.push({
			type: "Feature",
			geometry: { type: "LineString", coordinates: [from, to] },
			properties: { role: "link" },
		});
	if (plan) {
		const at = (pixel: Pixel) => project(plan.transform, pixel);
		plan.controlPoints.forEach(({ image, map }, i) => {
			const onPlan = at(image);
			line(onPlan, map);
			point(onPlan, "plan", String(i + 1));
			point(map, "target", String(i + 1));
		});
		if (tool?.kind === "points" && tool.pending) {
			point(at(tool.pending), "plan", "?");
		}
		if (tool?.kind === "measure") {
			const [a, b] = tool.points.map(at);
			if (a && b) line(a, b);
			for (const p of [a, b]) if (p) point(p, "plan");
		}
		if (tool?.kind === "rotate" && tool.pin) {
			point(at(tool.pin), "target");
		}
	}
	return { type: "FeatureCollection", features };
}

/** Draws `toolFeatures` above the indoor data. */
export class PlanToolLayer {
	readonly #map: MapLibreMap;
	#data: FeatureCollection = { type: "FeatureCollection", features: [] };
	#ready = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		const install = () => {
			map.addSource(TOOL_SOURCE, { type: "geojson", data: this.#data });
			map.addLayer({
				id: `${TOOL_SOURCE}-links`,
				type: "line",
				source: TOOL_SOURCE,
				filter: ["==", ["geometry-type"], "LineString"],
				paint: {
					"line-color": TOOL_COLOR,
					"line-width": 2,
					"line-dasharray": [2, 2],
				},
			});
			map.addLayer({
				id: `${TOOL_SOURCE}-points`,
				type: "circle",
				source: TOOL_SOURCE,
				filter: ["==", ["geometry-type"], "Point"],
				paint: {
					"circle-radius": 6,
					"circle-color": [
						"case",
						["==", ["get", "role"], "target"],
						TOOL_COLOR,
						"#ffffff",
					],
					"circle-stroke-color": TOOL_COLOR,
					"circle-stroke-width": 2,
				},
			});
			this.#ready = true;
		};
		if (map.isStyleLoaded()) install();
		else map.once("load", install);
	}

	setData(data: FeatureCollection): void {
		this.#data = data;
		if (this.#ready) {
			this.#map.getSource<GeoJSONSource>(TOOL_SOURCE)?.setData(data);
		}
	}

	remove(): void {
		if (!this.#ready) return;
		for (const id of [`${TOOL_SOURCE}-points`, `${TOOL_SOURCE}-links`]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(TOOL_SOURCE)) this.#map.removeSource(TOOL_SOURCE);
	}
}

/** Colour of the alignment marks: magenta stands out on plans, imagery and the indoor style. */
const TOOL_COLOR = "#d6249f";

/**
 * Whether a plan shows on a level: plans without a level, or with one that can't be read, show
 * everywhere rather than vanish.
 */
function isPlanOnLevel(plan: FloorPlan, level: number): boolean {
	const levels = plan.level === null ? null : parseLevels(plan.level);
	return levels === null || isOnLevel(levels, level);
}
