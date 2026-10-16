/**
 * Draws floor plans on the map: one MapLibre image source and raster layer per plan tile, above
 * the indoor fills (which would hide them) and below the indoor outlines, icons and labels. Plans are compared by identity, so only what
 * changed is updated: moving a plan sets new coordinates, it never re-uploads the image.
 */
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { PlanContent, RasterContent } from "#lib/floorplans/content.ts";
import {
	corners,
	groundDistance,
	type LngLat,
	type Pixel,
	project,
} from "#lib/floorplans/georef.ts";
import { pyramidLevel, tileCorners } from "#lib/floorplans/tiling.ts";
import { isOnLevel, parseLevels } from "#lib/levels/levels.ts";
import { EARTH_RADIUS } from "#lib/osm/geometry.ts";
import type {
	FloorPlan,
	LayerEntry,
	Tool,
} from "#lib/state/floorplans.svelte.ts";
import { BUILDINGS_LAYER } from "./indoor-map.ts";
import { slotId, slotsReady } from "./layer-slots.ts";
import type {
	ExpressionSpecification,
	GeoJSONSource,
	ImageSource,
	Map as MapLibreMap,
} from "./maplibre.ts";

/** Prefix of the floor plan source and layer ids. */
export const FLOORPLAN_PREFIX = "floorplan-";

interface Shown {
	readonly plan: FloorPlan;
	/** The content drawn (its raster's tiles at `level`). */
	readonly raster: RasterContent;
	readonly ids: readonly string[];
	/** Index of the pyramid level drawn. */
	readonly level: number;
}

export class FloorPlanLayers {
	readonly #map: MapLibreMap;
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;
	#layers: readonly LayerEntry[] = [];
	#plans: readonly FloorPlan[] = [];
	#contents: ReadonlyMap<string, PlanContent> = new Map();
	#level = 0;
	readonly #shown = new Map<string, Shown>();
	/** The map layers in stack order last time, to reorder only when it changes. */
	#order = "";

	constructor(map: MapLibreMap) {
		this.#map = map;
		const install = () => {
			this.#ready = true;
			this.#sync();
			// Zooming may call for another level of the plans' pyramids.
			map.on("zoom", this.#onZoom);
		};
		void slotsReady(map).then(() => {
			if (!this.#removed) install();
		});
	}

	/** Shows the plans of this stack, bottom first, the building outlines in their place. */
	setLayers(layers: readonly LayerEntry[]): void {
		this.#layers = layers;
		this.#plans = layers.flatMap((l) => (l.kind === "plan" ? [l.plan] : []));
		if (this.#ready) this.#sync();
	}

	/** The plans' content, by id: a plan without any yet isn't drawn. */
	setContents(contents: ReadonlyMap<string, PlanContent>): void {
		this.#contents = contents;
		if (this.#ready) this.#sync();
	}

	/** Shows only the plans of this level, and those not assigned to any. */
	setLevel(level: number): void {
		this.#level = level;
		if (this.#ready) this.#sync();
	}

	remove(): void {
		this.#removed = true;
		this.#map.off("zoom", this.#onZoom);
		for (const id of [...this.#shown.keys()]) this.#hide(id);
	}

	readonly #onZoom = () => this.#sync();

	#sync(): void {
		const wanted = this.#plans.filter(
			(p) =>
				p.visible &&
				isPlanOnLevel(p, this.#level) &&
				this.#contents.get(p.id)?.raster,
		);
		const levels = new Map(
			wanted.map((p) => [
				p.id,
				this.#pyramidLevel(
					p,
					this.#contents.get(p.id)?.raster as RasterContent,
				),
			]),
		);
		for (const [id, shown] of this.#shown) {
			if (
				shown.raster !== this.#contents.get(id)?.raster ||
				shown.level !== levels.get(id)
			) {
				this.#hide(id);
			}
		}
		let added = false;
		for (const plan of wanted) {
			const shown = this.#shown.get(plan.id);
			const raster = this.#contents.get(plan.id)?.raster;
			if (!shown && raster) {
				this.#show(plan, raster, levels.get(plan.id) ?? 0);
				added = true;
			} else if (shown && shown.plan !== plan) this.#update(shown, plan);
		}
		const order = stackLayerIds(
			this.#layers,
			(id) => this.#shown.get(id)?.ids ?? [],
			BUILDINGS_LAYER,
		).filter((id) => this.#map.getLayer(id));
		const key = order.join(",");
		if (!added && key === this.#order) return;
		this.#order = key;
		// Each one moved to the top of the plans' slot in turn: the last ends up on top.
		const below = this.#below();
		for (const id of order) this.#map.moveLayer(id, below);
	}

	/**
	 * The pyramid level to draw: the smallest one still having at least one pixel per screen
	 * pixel, so the GPU never shrinks a level by much more than half (`pyramidLevel` keeps the
	 * one drawn a little past its range while zooming).
	 */
	#pyramidLevel(plan: FloorPlan, raster: RasterContent): number {
		const { width, height } = plan.size;
		const centre: Pixel = [width / 2, height / 2];
		const step = Math.min(100, width / 2);
		const at = project(plan.transform, centre);
		// A raster pixel spans `unit` plan units.
		const metresPerImagePixel =
			(groundDistance(
				at,
				project(plan.transform, [centre[0] + step, centre[1]]),
			) /
				step) *
			raster.unit;
		// Ground size of a device pixel: the 512 px world at this zoom, at this latitude.
		const metresPerDevicePixel =
			(2 * Math.PI * EARTH_RADIUS * Math.cos((at[1] * Math.PI) / 180)) /
			(512 * 2 ** this.#map.getZoom()) /
			(window.devicePixelRatio || 1);
		return pyramidLevel(
			metresPerDevicePixel / metresPerImagePixel,
			raster.image.levels.length,
			this.#shown.get(plan.id)?.level,
		);
	}

	#show(plan: FloorPlan, raster: RasterContent, level: number): void {
		const tiles = raster.image.levels[level]?.tiles ?? [];
		const ids = tiles.map(({ tile, bitmap }, i) => {
			const id = `${FLOORPLAN_PREFIX}${plan.id}-${i}`;
			this.#map.addSource(id, {
				type: "image",
				coordinates: tileCorners(plan.transform, tile, raster.unit),
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
		this.#shown.set(plan.id, { plan, raster, ids, level });
	}

	#update(shown: Shown, plan: FloorPlan): void {
		if (plan.transform !== shown.plan.transform) {
			const { image, unit } = shown.raster;
			image.levels[shown.level]?.tiles.forEach(({ tile }, i) => {
				const id = shown.ids[i];
				if (!id) return;
				this.#map
					.getSource<ImageSource>(id)
					?.setCoordinates(tileCorners(plan.transform, tile, unit));
			});
		}
		if (plan.opacity !== shown.plan.opacity) {
			for (const id of shown.ids) {
				this.#map.setPaintProperty(id, "raster-opacity", plan.opacity);
			}
		}
		this.#shown.set(plan.id, { ...shown, plan });
	}

	#hide(id: string): void {
		for (const layer of this.#shown.get(id)?.ids ?? []) {
			if (this.#map.getLayer(layer)) this.#map.removeLayer(layer);
			if (this.#map.getSource(layer)) this.#map.removeSource(layer);
		}
		this.#shown.delete(id);
	}

	/** Plans go in their slot: over indoor fills, under indoor outlines. */
	#below(): string {
		return slotId("plans");
	}
}

/**
 * The map layers of a layer stack, bottom first: each drawn plan's tiles (`tilesOf`), and the
 * building outlines' layer in its place.
 */
export function stackLayerIds(
	layers: readonly LayerEntry[],
	tilesOf: (planId: string) => readonly string[],
	buildingsLayer: string,
): string[] {
	return layers.flatMap((l) =>
		l.kind === "plan" ? [...tilesOf(l.plan.id)] : [buildingsLayer],
	);
}

const TOOL_SOURCE = "floorplan-tool";
/** How far above the plan's top edge its rotation handle sits, in plan heights. */
export const ROTATE_HANDLE_OFFSET = 0.08;

/**
 * The tools' points, handles included: corners (`role: "handle"`, `corner` 0–3) and the
 * rotation handle (`role: "rotate"`).
 */
export const HANDLES_LAYER = `${TOOL_SOURCE}-points`;

/**
 * Frames of the plans shown on `level` (`role: "frame"`), each in the plan's colour, so that
 * plans are told apart in floor plan mode.
 */
export function planFrames(
	plans: readonly FloorPlan[],
	level: number,
): FeatureCollection<LineString> {
	return {
		type: "FeatureCollection",
		features: plans
			.filter((p) => p.visible && isPlanOnLevel(p, level))
			.map((plan) => {
				const frame = corners(
					plan.transform,
					plan.size.width,
					plan.size.height,
				);
				return {
					type: "Feature",
					geometry: { type: "LineString", coordinates: [...frame, frame[0]] },
					properties: { role: "frame", color: plan.color },
				};
			}),
	};
}

/**
 * Marks of the alignment tools, in the plan's colour: control points, measured spots, the
 * rotation pin, and with `handles` the corner handles and the rotation handle to drag. While measuring, a line follows
 * the `pointer` from the first spot (`role: "rubber"`), then joins the two spots
 * (`role: "measured"`).
 */
export function toolFeatures(
	plan: FloorPlan | null,
	tool: Tool | null,
	handles = false,
	pointer?: LngLat | null,
): FeatureCollection<Point | LineString> {
	const features: Feature<Point | LineString>[] = [];
	if (!plan) return { type: "FeatureCollection", features };
	const { color } = plan;
	const point = (
		position: LngLat,
		role: string,
		extra: Record<string, unknown> = {},
	) =>
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: position },
			properties: { role, color, ...extra },
		});
	const line = (from: LngLat, to: LngLat, role = "link") =>
		features.push({
			type: "Feature",
			geometry: { type: "LineString", coordinates: [from, to] },
			properties: { role, color },
		});
	const at = (pixel: Pixel) => project(plan.transform, pixel);
	if (handles) {
		const { width, height } = plan.size;
		for (const [i, corner] of corners(
			plan.transform,
			width,
			height,
		).entries()) {
			point(corner, "handle", { corner: i });
		}
		point(at([width / 2, -ROTATE_HANDLE_OFFSET * height]), "rotate");
	}
	plan.controlPoints.forEach(({ image, map }, i) => {
		const onPlan = at(image);
		line(onPlan, map);
		point(onPlan, "plan", { label: String(i + 1) });
		point(map, "target", { label: String(i + 1) });
	});
	if (tool?.kind === "points" && tool.pending) {
		point(at(tool.pending), "plan", { label: "?" });
	}
	if (tool?.kind === "measure") {
		const [a, b] = tool.points.map(at);
		if (a && b) line(a, b, "measured");
		else if (a && pointer) line(a, pointer, "rubber");
		for (const p of [a, b]) if (p) point(p, "plan");
	}
	if (tool?.kind === "rotate" && tool.pin) {
		point(at(tool.pin), "target");
	}
	return { type: "FeatureCollection", features };
}

/** Draws `toolFeatures` above the indoor data. */
export class PlanToolLayer {
	readonly #map: MapLibreMap;
	#data: FeatureCollection = { type: "FeatureCollection", features: [] };
	#ready = false;
	/** Removed before the style was ready: never installed. */
	#removed = false;

	constructor(map: MapLibreMap) {
		this.#map = map;
		const install = () => {
			map.addSource(TOOL_SOURCE, { type: "geojson", data: this.#data });
			// Over everything else: the marks are what the user is working with.
			const tools = slotId("tools");
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-frame`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["==", ["get", "role"], "frame"],
					paint: { "line-color": PLAN_COLOR, "line-width": 2 },
				},
				tools,
			);
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-measured`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["==", ["get", "role"], "measured"],
					paint: { "line-color": PLAN_COLOR, "line-width": 2 },
				},
				tools,
			);
			map.addLayer(
				{
					id: `${TOOL_SOURCE}-links`,
					type: "line",
					source: TOOL_SOURCE,
					filter: ["in", ["get", "role"], ["literal", ["link", "rubber"]]],
					paint: {
						"line-color": PLAN_COLOR,
						"line-width": 2,
						"line-dasharray": [2, 2],
					},
				},
				tools,
			);
			map.addLayer(
				{
					id: HANDLES_LAYER,
					type: "circle",
					source: TOOL_SOURCE,
					filter: ["==", ["geometry-type"], "Point"],
					paint: {
						"circle-radius": [
							"match",
							["get", "role"],
							["handle", "rotate"],
							7,
							6,
						],
						"circle-color": [
							"match",
							["get", "role"],
							["target", "rotate"],
							PLAN_COLOR,
							"#ffffff",
						],
						"circle-stroke-color": PLAN_COLOR,
						"circle-stroke-width": 2,
					},
				},
				tools,
			);
			this.#ready = true;
		};
		void slotsReady(map).then(() => {
			if (!this.#removed) install();
		});
	}

	setData(data: FeatureCollection): void {
		this.#data = data;
		if (this.#ready) {
			this.#map.getSource<GeoJSONSource>(TOOL_SOURCE)?.setData(data);
		}
	}

	remove(): void {
		this.#removed = true;
		if (!this.#ready) return;
		for (const id of [
			HANDLES_LAYER,
			`${TOOL_SOURCE}-links`,
			`${TOOL_SOURCE}-measured`,
			`${TOOL_SOURCE}-frame`,
		]) {
			if (this.#map.getLayer(id)) this.#map.removeLayer(id);
		}
		if (this.#map.getSource(TOOL_SOURCE)) this.#map.removeSource(TOOL_SOURCE);
	}
}

/** Each mark is drawn in the colour of its plan. */
const PLAN_COLOR: ExpressionSpecification = ["get", "color"];

/**
 * Whether a plan shows on a level: plans without a level, or with one that can't be read, show
 * everywhere rather than vanish.
 */
function isPlanOnLevel(plan: FloorPlan, level: number): boolean {
	const levels = plan.level === null ? null : parseLevels(plan.level);
	return levels === null || isOnLevel(levels, level);
}
