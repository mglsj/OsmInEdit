/**
 * Floor plans shown under the indoor data: their images, where they sit on the map, and how
 * they are shown. Plans are replaced, never mutated, so the map layers can tell what changed.
 */
import {
	type ControlPoint,
	type Fit,
	fitPlan,
	GeorefError,
	type LngLat,
	type Pixel,
	place,
	rotateAbout,
	scaleToDistance,
	type Transform,
	type TransformKind,
	translateTo,
	unproject,
} from "#lib/floorplans/georef.ts";
import type { PlanImage } from "#lib/floorplans/import.ts";

export interface FloorPlan {
	readonly id: string;
	readonly name: string;
	readonly image: PlanImage;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	/** Transform fitted to the control points, once there are enough of them. */
	readonly fitKind: TransformKind;
	/** 0 to 1. Half-transparent by default, so the map shows through. */
	readonly opacity: number;
	/** OSM level the plan belongs to, like `0`; null when not assigned. */
	readonly level: string | null;
	readonly visible: boolean;
}

export const DEFAULT_OPACITY = 0.5;

/** Control points each kind of fit needs. */
export const MIN_POINTS: Record<TransformKind, number> = {
	similarity: 2,
	affine: 3,
	projective: 4,
};

/**
 * The alignment tool in use, and how far along it is:
 * - `points`: click a spot on the plan, then where it really is on the map;
 * - `measure`: click two spots on the plan, then give their real distance;
 * - `rotate`: click the spot to turn around, then give an angle.
 */
export type Tool =
	| { readonly kind: "points"; readonly pending: Pixel | null }
	| { readonly kind: "measure"; readonly points: readonly Pixel[] }
	| { readonly kind: "rotate"; readonly pin: Pixel | null };

/** The part of the view height a new plan takes. */
const INITIAL_HEIGHT = 0.6;

export interface View {
	readonly center: LngLat;
	/** Height of the visible map, in ground metres. */
	readonly heightMetres: number;
}

export class FloorPlans {
	plans = $state.raw<readonly FloorPlan[]>([]);
	selectedId = $state<string | null>(null);
	readonly selected = $derived(
		this.plans.find((p) => p.id === this.selectedId) ?? null,
	);
	/** Alignment tool for the selected plan; map clicks go to it instead of the indoor data. */
	tool = $state.raw<Tool | null>(null);
	/** How well the selected plan fits its control points. */
	readonly fit = $derived.by((): Fit | null => {
		const plan = this.selected;
		if (!plan || plan.controlPoints.length < 2) return null;
		return fitPlan(plan.controlPoints, usableKind(plan));
	});

	/** Adds a plan north up in the middle of the view, 60% of its height tall, and selects it. */
	add(image: PlanImage, name: string, view: View, level: string | null): void {
		const transform = place(
			{
				center: view.center,
				metresPerPixel: (view.heightMetres * INITIAL_HEIGHT) / image.height,
				bearing: 0,
			},
			image.width,
			image.height,
		);
		const plan: FloorPlan = {
			id: crypto.randomUUID(),
			name,
			image,
			transform,
			controlPoints: [],
			fitKind: "similarity",
			opacity: DEFAULT_OPACITY,
			level,
			visible: true,
		};
		this.plans = [...this.plans, plan];
		this.select(plan.id);
	}

	select(id: string | null): void {
		this.selectedId = id;
		this.tool = null;
	}

	setTool(kind: Tool["kind"] | null): void {
		switch (kind) {
			case "points":
				this.tool = { kind, pending: null };
				break;
			case "measure":
				this.tool = { kind, points: [] };
				break;
			case "rotate":
				this.tool = { kind, pin: null };
				break;
			default:
				this.tool = null;
		}
	}

	/**
	 * A click on the map while a tool is active, at `position` (already snapped to an OSM node
	 * when close to one). Returns a message when the click can't be used.
	 */
	click(position: LngLat): string | null {
		const plan = this.selected;
		const tool = this.tool;
		if (!plan || !tool) return null;
		const onPlan = pixelOn(plan, position);
		switch (tool.kind) {
			case "points":
				if (!tool.pending) {
					if (!onPlan) return "Click a spot on the plan first.";
					this.tool = { kind: "points", pending: onPlan };
				} else {
					this.#setControlPoints(plan, [
						...plan.controlPoints,
						{ image: tool.pending, map: position },
					]);
					this.tool = { kind: "points", pending: null };
				}
				return null;
			case "measure":
				if (!onPlan) return "Click on the plan to measure.";
				this.tool = {
					kind: "measure",
					points: tool.points.length >= 2 ? [onPlan] : [...tool.points, onPlan],
				};
				return null;
			case "rotate":
				if (!onPlan) return "Click on the plan to pick the centre of rotation.";
				this.tool = { kind: "rotate", pin: onPlan };
				return null;
		}
	}

	removeControlPoint(index: number): void {
		const plan = this.selected;
		if (!plan) return;
		this.#setControlPoints(
			plan,
			plan.controlPoints.filter((_, i) => i !== index),
		);
	}

	setFitKind(fitKind: TransformKind): void {
		const plan = this.selected;
		if (!plan) return;
		this.#setControlPoints({ ...plan, fitKind }, plan.controlPoints);
	}

	/** Scales the selected plan so the two measured spots are `metres` apart. */
	scaleTo(metres: number): void {
		const plan = this.selected;
		const tool = this.tool;
		if (!plan || tool?.kind !== "measure") return;
		const [a, b] = tool.points;
		if (!a || !b) return;
		this.#place(plan, scaleToDistance(plan.transform, a, b, metres));
		this.tool = { kind: "measure", points: [] };
	}

	/** Turns the selected plan clockwise around the picked spot. */
	rotate(degrees: number): void {
		const plan = this.selected;
		const tool = this.tool;
		if (!plan || tool?.kind !== "rotate" || !tool.pin) return;
		this.#place(plan, rotateAbout(plan.transform, tool.pin, degrees));
	}

	/**
	 * New control points: one moves the plan onto it, two or more fit the plan to them. Without
	 * any, the plan stays where it is.
	 */
	#setControlPoints(
		plan: FloorPlan,
		controlPoints: readonly ControlPoint[],
	): void {
		let { transform } = plan;
		const [first] = controlPoints;
		if (controlPoints.length === 1 && first) {
			transform = translateTo(transform, first.image, first.map);
		} else if (controlPoints.length >= 2) {
			transform = fitPlan(
				controlPoints,
				usableKind({ ...plan, controlPoints }),
			).transform;
		}
		this.#replace({ ...plan, controlPoints, transform });
	}

	/**
	 * Moves a plan by hand (scale, rotation). Control points no longer match the new place, so
	 * they are dropped.
	 */
	#place(plan: FloorPlan, transform: Transform): void {
		this.#replace({ ...plan, transform, controlPoints: [] });
	}

	#replace(plan: FloorPlan): void {
		this.plans = this.plans.map((p) => (p.id === plan.id ? plan : p));
	}

	update(id: string, changes: Partial<Omit<FloorPlan, "id" | "image">>): void {
		this.plans = this.plans.map((p) =>
			p.id === id ? { ...p, ...changes } : p,
		);
	}

	remove(id: string): void {
		const plan = this.plans.find((p) => p.id === id);
		this.plans = this.plans.filter((p) => p.id !== id);
		if (this.selectedId === id) this.select(null);
		for (const { bitmap } of plan?.image.tiles ?? []) bitmap.close();
	}
}

/** The plan's fit kind if it has enough control points, else the simplest fit. */
function usableKind(plan: FloorPlan): TransformKind {
	return plan.controlPoints.length >= MIN_POINTS[plan.fitKind]
		? plan.fitKind
		: "similarity";
}

/** The pixel of the plan at a map position, or null when the position is off the plan. */
function pixelOn(plan: FloorPlan, position: LngLat): Pixel | null {
	try {
		const [u, v] = unproject(plan.transform, position);
		const { width, height } = plan.image;
		return u >= 0 && v >= 0 && u <= width && v <= height ? [u, v] : null;
	} catch (e) {
		if (e instanceof GeorefError) return null;
		throw e;
	}
}
