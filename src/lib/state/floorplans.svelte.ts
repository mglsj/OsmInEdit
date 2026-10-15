/**
 * Floor plans shown under the indoor data: their images, where they sit on the map, and how
 * they are shown. Plans are replaced, never mutated, so the map layers can tell what changed.
 */

import { pickColor } from "#lib/floorplans/colors.ts";
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
import type { PlanStore, StoredPlan } from "#lib/persist/plan-store.ts";

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
	/** Colour of its frame, handles and marks: one of `PLAN_COLORS`, `#rrggbb`. */
	readonly color: string;
}

/** The building outlines' place in the stack: how many plans are under them. */
export interface BuildingsLayer {
	readonly below: number;
	readonly visible: boolean;
}

export type LayerEntry =
	| { readonly kind: "plan"; readonly plan: FloorPlan }
	| { readonly kind: "buildings" };

/** Key of the building outlines in `FloorPlans.move`. */
export const BUILDINGS = "buildings";

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

export interface FloorPlansOptions {
	/** Where plans are saved; without it they last until the page is closed. */
	readonly store?: PlanStore;
	/** Decodes a saved image. */
	readonly decode?: (image: Blob) => Promise<PlanImage>;
}

export class FloorPlans {
	plans = $state.raw<readonly FloorPlan[]>([]);
	/** Set when plans could not be saved or restored. */
	storageError = $state<string | null>(null);
	/** The building outlines' entry in the layer stack: how many plans are drawn under them. */
	buildings = $state.raw<BuildingsLayer>({ below: 0, visible: true });
	/** The layer stack of floor plan mode, bottom first: the plans and the building outlines. */
	readonly layers = $derived.by((): LayerEntry[] => {
		const entries: LayerEntry[] = this.plans.map((plan) => ({
			kind: "plan",
			plan,
		}));
		entries.splice(this.buildings.below, 0, { kind: "buildings" });
		return entries;
	});
	/**
	 * The plan in Edit, the only one that can be changed; other plans are locked. Its changes are
	 * kept out of storage until Done, and Cancel puts it back as it was when Edit was pressed.
	 */
	editingId = $state<string | null>(null);
	readonly editing = $derived(
		this.plans.find((p) => p.id === this.editingId) ?? null,
	);
	/** The plan in Edit as it was when Edit was pressed. */
	#before = $state.raw<FloorPlan | null>(null);
	/** Whether the plan in Edit has changes Done would save. */
	readonly dirty = $derived(
		this.editing !== null && this.editing !== this.#before,
	);
	/** Set while `whenSaved` asks whether to save or discard the plan in Edit. */
	confirming = $state(false);
	#afterConfirm: (() => void) | null = null;
	/** Alignment tool for the plan in Edit; map clicks go to it instead of the indoor data. */
	tool = $state.raw<Tool | null>(null);
	/** How well the plan in Edit fits its control points. */
	readonly fit = $derived.by((): Fit | null => {
		const plan = this.editing;
		if (!plan || plan.controlPoints.length < 2) return null;
		return fitPlan(plan.controlPoints, usableKind(plan));
	});

	readonly #store: PlanStore | undefined;
	readonly #decode: FloorPlansOptions["decode"];

	constructor({ store, decode }: FloorPlansOptions = {}) {
		this.#store = store;
		this.#decode = decode;
	}

	/** Brings back the plans saved in earlier visits. */
	async restore(): Promise<void> {
		const decode = this.#decode;
		if (!this.#store || !decode) return;
		try {
			const [saved, buildings] = await Promise.all([
				this.#store.load(),
				this.#store.loadBuildings(),
			]);
			const decoded = await Promise.all(
				saved.map(async ({ plan: { order: _order, ...plan }, image }) => ({
					...plan,
					image: await decode(image),
				})),
			);
			// Plans saved before they had colours get one, kept from then on.
			const used = [...this.plans, ...decoded].flatMap((p) =>
				p.color ? [p.color] : [],
			);
			const recolored: FloorPlan[] = [];
			const restored = decoded.map((plan): FloorPlan => {
				if (plan.color) return { ...plan, color: plan.color };
				const color = pickColor(used);
				used.push(color);
				const withColor = { ...plan, color };
				recolored.push(withColor);
				return withColor;
			});
			// Plans added while restoring stay on top. Without a saved place (saved before the
			// outlines were in the list), the outlines go on top of the plans.
			const below = buildings
				? saved.filter(({ plan }) => plan.order < buildings.order).length
				: restored.length;
			this.plans = [...restored, ...this.plans];
			this.buildings = {
				below,
				visible: buildings?.visible ?? true,
			};
			for (const plan of recolored) this.#save(plan);
		} catch (e) {
			this.storageError = `Saved floor plans could not be restored: ${(e as Error).message}`;
		}
	}

	/** Adds a plan north up in the middle of the view, 60% of its height tall, in Edit. */
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
		this.insert({
			name,
			image,
			transform,
			controlPoints: [],
			fitKind: "similarity",
			opacity: DEFAULT_OPACITY,
			level,
			visible: true,
		});
	}

	/**
	 * Adds an already placed plan (from a file) on top of the others, saved as it is and opened in
	 * Edit. Without a colour, it gets one no other plan has.
	 */
	insert(
		fields: Omit<FloorPlan, "id" | "color"> & { readonly color?: string },
	): void {
		const plan: FloorPlan = {
			id: crypto.randomUUID(),
			...fields,
			color: fields.color ?? pickColor(this.plans.map((p) => p.color)),
		};
		// Above the other plans: under the outlines if they are on top.
		const outlinesOnTop = this.buildings.below === this.plans.length;
		this.plans = [...this.plans, plan];
		if (outlinesOnTop) {
			this.buildings = { ...this.buildings, below: this.plans.length };
			this.#saveBuildings();
		}
		this.#persist(this.#store?.saveImage(plan.id, plan.image.blob));
		this.#save(plan);
		this.edit(plan.id);
	}

	/**
	 * Opens a plan in Edit. Unsaved changes to another plan in Edit are dropped: ask first with
	 * `whenSaved`.
	 */
	edit(id: string): void {
		if (this.editingId) this.cancel();
		const plan = this.plans.find((p) => p.id === id);
		if (!plan) return;
		this.editingId = id;
		this.#before = plan;
	}

	/** Saves the plan in Edit and locks it again. */
	done(): void {
		const plan = this.editing;
		this.#endEdit();
		if (plan) this.#save(plan);
	}

	/** Puts the plan in Edit back as it was when Edit was pressed, and locks it again. */
	cancel(): void {
		const before = this.#before;
		if (before) {
			this.plans = this.plans.map((p) => (p.id === before.id ? before : p));
		}
		this.#endEdit();
	}

	#endEdit(): void {
		this.editingId = null;
		this.#before = null;
		this.tool = null;
	}

	/**
	 * Runs `action` once the plan in Edit has no unsaved changes: at once, or after asking to
	 * save or discard them (`confirming`, answered with `resolve`).
	 */
	whenSaved(action: () => void): void {
		if (!this.dirty) {
			action();
			return;
		}
		this.#afterConfirm = action;
		this.confirming = true;
	}

	/** The answer to `whenSaved`'s question; "keep" goes back to editing and drops the action. */
	resolve(choice: "save" | "discard" | "keep"): void {
		const action = this.#afterConfirm;
		this.#afterConfirm = null;
		this.confirming = false;
		if (choice === "keep") return;
		if (choice === "save") this.done();
		else this.cancel();
		action?.();
	}

	/** Shows or hides a plan, saved at once: not part of an edit session. */
	setVisible(id: string, visible: boolean): void {
		const plan = this.plans.find((p) => p.id === id);
		if (!plan) return;
		const shown = { ...plan, visible };
		const before = this.#before;
		if (id === this.editingId && before) {
			// Cancel keeps it, and storage gets it without the changes still in Edit.
			this.#before = this.dirty ? { ...before, visible } : shown;
			this.#save(this.#before);
		} else {
			this.#save(shown);
		}
		this.plans = this.plans.map((p) => (p.id === id ? shown : p));
	}

	setTool(kind: Tool["kind"] | null): void {
		if (!this.editing) {
			this.tool = null;
			return;
		}
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
		const plan = this.editing;
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
		const plan = this.editing;
		if (!plan) return;
		this.#setControlPoints(
			plan,
			plan.controlPoints.filter((_, i) => i !== index),
		);
	}

	/**
	 * Removes every control point of the plan in Edit, which stays where they put it, and the
	 * active tool's half-done pick.
	 */
	clearPoints(): void {
		const plan = this.editing;
		if (plan && plan.controlPoints.length > 0) {
			this.#replace({ ...plan, controlPoints: [] });
		}
		if (this.tool) this.setTool(this.tool.kind);
	}

	setFitKind(fitKind: TransformKind): void {
		const plan = this.editing;
		if (!plan) return;
		this.#setControlPoints({ ...plan, fitKind }, plan.controlPoints);
	}

	/** Scales the plan in Edit so the two measured spots are `metres` apart. */
	scaleTo(metres: number): void {
		const plan = this.editing;
		const tool = this.tool;
		if (!plan || tool?.kind !== "measure") return;
		const [a, b] = tool.points;
		if (!a || !b) return;
		this.#place(plan, scaleToDistance(plan.transform, a, b, metres));
		this.tool = { kind: "measure", points: [] };
	}

	/** Shows the plan in Edit at a new place while it is being dragged. */
	preview(id: string, transform: Transform): void {
		if (id !== this.editingId) return;
		this.plans = this.plans.map((p) => (p.id === id ? { ...p, transform } : p));
	}

	/** Where the plan in Edit was dropped: its control points no longer match, and go. */
	commitPlacement(id: string): void {
		const plan = this.editing;
		if (plan?.id === id) this.#place(plan, plan.transform);
	}

	/** Turns the plan in Edit clockwise around the picked spot. */
	rotate(degrees: number): void {
		const plan = this.editing;
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

	/** A change to the plan in Edit, saved by Done. */
	#replace(plan: FloorPlan): void {
		this.plans = this.plans.map((p) => (p.id === plan.id ? plan : p));
	}

	/** Changes the plan in Edit; locked plans are left alone. */
	update(
		id: string,
		changes: Partial<Omit<FloorPlan, "id" | "image" | "visible">>,
	): void {
		const plan = this.editing;
		if (plan?.id === id) this.#replace({ ...plan, ...changes });
	}

	remove(id: string): void {
		const index = this.plans.findIndex((p) => p.id === id);
		const plan = this.plans[index];
		this.plans = this.plans.filter((p) => p.id !== id);
		if (index >= 0 && index < this.buildings.below) {
			// Saved places keep their order: nothing to save.
			this.buildings = { ...this.buildings, below: this.buildings.below - 1 };
		}
		if (this.editingId === id) this.#endEdit();
		for (const level of plan?.image.levels ?? []) {
			for (const { bitmap } of level.tiles) bitmap.close();
		}
		this.#persist(this.#store?.delete(id));
	}

	/** Moves a plan (by id) or the outlines (`BUILDINGS`) to `index` in the stack, bottom first. */
	move(key: string, index: number): void {
		const keys = this.layers.map((l) =>
			l.kind === "plan" ? l.plan.id : BUILDINGS,
		);
		const from = keys.indexOf(key);
		if (from < 0) return;
		const to = Math.max(0, Math.min(keys.length - 1, Math.round(index)));
		if (to === from) return;
		keys.splice(from, 1);
		keys.splice(to, 0, key);
		const byId = new Map(this.plans.map((p) => [p.id, p]));
		this.plans = keys.flatMap((k) => byId.get(k) ?? []);
		this.buildings = { ...this.buildings, below: keys.indexOf(BUILDINGS) };
		// Every place may have changed, saved in one write; the plan in Edit is saved as it was
		// when Edit was pressed.
		const before = this.#before;
		const { below, visible } = this.buildings;
		this.#persist(
			this.#store?.saveStack(
				this.plans.map((plan) =>
					this.#stored(plan.id === this.editingId && before ? before : plan),
				),
				{ order: below, visible },
			),
		);
	}

	/** Shows or hides the building outlines in floor plan mode, saved at once. */
	setBuildingsVisible(visible: boolean): void {
		this.buildings = { ...this.buildings, visible };
		this.#saveBuildings();
	}

	#saveBuildings(): void {
		const { below, visible } = this.buildings;
		this.#persist(this.#store?.saveBuildings({ order: below, visible }));
	}

	#save(plan: FloorPlan): void {
		this.#persist(this.#store?.save(this.#stored(plan)));
	}

	/** A plan's settings as stored: everything but its image, and its place in the stack. */
	#stored(plan: FloorPlan): StoredPlan {
		const { image: _, ...settings } = plan;
		const index = this.plans.findIndex((p) => p.id === plan.id);
		// The outlines take a place in the stack too.
		return {
			...settings,
			order: index + (index >= this.buildings.below ? 1 : 0),
		};
	}

	/** Reports a failed write: plans stay usable, but won't survive a reload. */
	#persist(write: Promise<void> | undefined): void {
		write?.catch((e: Error) => {
			this.storageError = `Floor plans could not be saved in this browser: ${e.message}`;
		});
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
