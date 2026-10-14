/**
 * Floor plans shown under the indoor data: their images, where they sit on the map, and how
 * they are shown. Plans are replaced, never mutated, so the map layers can tell what changed.
 */
import {
	type ControlPoint,
	type LngLat,
	place,
	type Transform,
} from "#lib/floorplans/georef.ts";
import type { PlanImage } from "#lib/floorplans/import.ts";

export interface FloorPlan {
	readonly id: string;
	readonly name: string;
	readonly image: PlanImage;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	/** 0 to 1. Half-transparent by default, so the map shows through. */
	readonly opacity: number;
	/** OSM level the plan belongs to, like `0`; null when not assigned. */
	readonly level: string | null;
	readonly visible: boolean;
}

export const DEFAULT_OPACITY = 0.5;

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
			opacity: DEFAULT_OPACITY,
			level,
			visible: true,
		};
		this.plans = [...this.plans, plan];
		this.selectedId = plan.id;
	}

	update(id: string, changes: Partial<Omit<FloorPlan, "id" | "image">>): void {
		this.plans = this.plans.map((p) =>
			p.id === id ? { ...p, ...changes } : p,
		);
	}

	remove(id: string): void {
		const plan = this.plans.find((p) => p.id === id);
		this.plans = this.plans.filter((p) => p.id !== id);
		if (this.selectedId === id) this.selectedId = null;
		for (const { bitmap } of plan?.image.tiles ?? []) bitmap.close();
	}
}
