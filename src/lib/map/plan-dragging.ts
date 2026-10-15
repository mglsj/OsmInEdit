/**
 * Dragging a floor plan on the map, as in photo editors: its body to move it, a corner handle
 * to resize it (Shift: change the proportions, Ctrl/⌘: from the centre, Alt: move that corner
 * alone), the handle above it to turn it (Shift: in 15° steps). Moves are previewed live and
 * saved once, on release.
 */
import {
	dragCorner,
	dragRotation,
	type LngLat,
	type Pixel,
	type Transform,
	translateTo,
	unproject,
} from "#lib/floorplans/georef.ts";
import type { FloorPlan } from "#lib/state/floorplans.svelte.ts";
import { HANDLES_LAYER } from "./floorplan-layers.ts";
import type { Map as MapLibreMap, MapMouseEvent } from "./maplibre.ts";

/** Cursors shown over a plan that can be dragged. */
const DRAG_CURSORS = new Set(["nwse-resize", "grab", "move"]);

/** How far from a corner handle a press still grabs it, in pixels. */
const HANDLE_TOLERANCE = 8;

export interface PlanDraggingOptions {
	/** The plan that can be dragged, if any. */
	readonly plan: () => FloorPlan | null;
	readonly onmove: (id: string, transform: Transform) => void;
	readonly onend: (id: string) => void;
}

type Grab =
	| { readonly kind: "corner"; readonly corner: number }
	| { readonly kind: "rotate" }
	| { readonly kind: "body"; readonly pixel: Pixel };

export class PlanDragging {
	readonly #map: MapLibreMap;
	readonly #options: PlanDraggingOptions;
	#drag: { plan: FloorPlan; grab: Grab } | null = null;

	constructor(map: MapLibreMap, options: PlanDraggingOptions) {
		this.#map = map;
		this.#options = options;
		map.on("mousedown", this.#onDown);
		map.on("mousemove", this.#onMove);
		// Released anywhere, even off the map.
		window.addEventListener("mouseup", this.#onUp);
	}

	remove(): void {
		this.#map.off("mousedown", this.#onDown);
		this.#map.off("mousemove", this.#onMove);
		window.removeEventListener("mouseup", this.#onUp);
	}

	readonly #onDown = (event: MapMouseEvent) => {
		const plan = this.#options.plan();
		if (!plan || event.originalEvent.button !== 0) return;
		const grab = this.#grab(plan, event);
		if (!grab) return;
		// Keep the map still: this drag moves the plan.
		event.preventDefault();
		this.#drag = { plan, grab };
	};

	readonly #onMove = (event: MapMouseEvent) => {
		const drag = this.#drag;
		if (!drag) {
			this.#updateCursor(event);
			return;
		}
		const { plan, grab } = drag;
		const target: LngLat = [event.lngLat.lng, event.lngLat.lat];
		const { shiftKey, ctrlKey, metaKey, altKey } = event.originalEvent;
		const transform =
			grab.kind === "body"
				? translateTo(plan.transform, grab.pixel, target)
				: grab.kind === "rotate"
					? dragRotation(
							plan.transform,
							plan.image.width,
							plan.image.height,
							target,
							{ snap: shiftKey },
						)
					: dragCorner(
							plan.transform,
							plan.image.width,
							plan.image.height,
							grab.corner,
							target,
							{
								freeAspect: shiftKey,
								fromCenter: ctrlKey || metaKey,
								distort: altKey,
							},
						);
		this.#options.onmove(plan.id, transform);
	};

	readonly #onUp = () => {
		const drag = this.#drag;
		if (!drag) return;
		this.#drag = null;
		this.#options.onend(drag.plan.id);
	};

	/** What a press grabs: a corner handle, the plan itself, or nothing. */
	#grab(plan: FloorPlan, event: MapMouseEvent): Grab | null {
		const { x, y } = event.point;
		const handle = this.#map.getLayer(HANDLES_LAYER)
			? this.#map
					.queryRenderedFeatures(
						[
							[x - HANDLE_TOLERANCE, y - HANDLE_TOLERANCE],
							[x + HANDLE_TOLERANCE, y + HANDLE_TOLERANCE],
						],
						{ layers: [HANDLES_LAYER] },
					)
					.find(
						(f) =>
							f.properties.role === "handle" || f.properties.role === "rotate",
					)
			: undefined;
		if (handle?.properties.role === "rotate") return { kind: "rotate" };
		if (handle)
			return { kind: "corner", corner: Number(handle.properties.corner) };
		const [u, v] = unproject(plan.transform, [
			event.lngLat.lng,
			event.lngLat.lat,
		]);
		const { width, height } = plan.image;
		return u >= 0 && v >= 0 && u <= width && v <= height
			? { kind: "body", pixel: [u, v] }
			: null;
	}

	#updateCursor(event: MapMouseEvent): void {
		const canvas = this.#map.getCanvas();
		const plan = this.#options.plan();
		if (!plan) {
			// Nothing to drag: back to the map's own cursor, leaving others' (a tool's) alone.
			if (DRAG_CURSORS.has(canvas.style.cursor)) canvas.style.cursor = "";
			return;
		}
		const grab = this.#grab(plan, event);
		const cursor =
			grab?.kind === "corner"
				? "nwse-resize"
				: grab?.kind === "rotate"
					? "grab"
					: grab?.kind === "body"
						? "move"
						: "";
		canvas.style.cursor = cursor;
	}
}
