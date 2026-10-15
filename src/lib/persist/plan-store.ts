/**
 * Floor plans kept in the browser's IndexedDB, so they survive reloads. Images and settings are
 * stored apart: an image is written once, while settings change with every slider move. Nothing
 * leaves the user's browser.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type {
	ControlPoint,
	Transform,
	TransformKind,
} from "#lib/floorplans/georef.ts";

/** A plan's settings: everything but its image. */
export interface StoredPlan {
	readonly id: string;
	readonly name: string;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	readonly fitKind: TransformKind;
	readonly opacity: number;
	readonly level: string | null;
	readonly visible: boolean;
	/** `#rrggbb`; plans saved before colours existed have none. */
	readonly color?: string;
	/** Place in the layer stack, the building outlines included: lowest first. */
	readonly order: number;
}

/** The building outlines' place in the layer stack (same scale as plans' `order`). */
export interface StoredBuildings {
	readonly order: number;
	readonly visible: boolean;
}

/** Where plans are saved; an interface so that state can run without IndexedDB. */
export interface PlanStore {
	/** Saved plans with their images, in drawing order. */
	load(): Promise<{ plan: StoredPlan; image: Blob }[]>;
	saveImage(id: string, image: Blob): Promise<void>;
	save(plan: StoredPlan): Promise<void>;
	delete(id: string): Promise<void>;
	/** Undefined until the outlines were first moved or hidden. */
	loadBuildings(): Promise<StoredBuildings | undefined>;
	saveBuildings(buildings: StoredBuildings): Promise<void>;
	/** Saves several plans and the outlines' place at once (a reorder), in one write. */
	saveStack(
		plans: readonly StoredPlan[],
		buildings: StoredBuildings,
	): Promise<void>;
}

interface Schema extends DBSchema {
	plans: { key: string; value: StoredPlan };
	images: { key: string; value: Blob };
	settings: { key: string; value: StoredBuildings };
}

export class IndexedDbPlanStore implements PlanStore {
	#db: Promise<IDBPDatabase<Schema>> | undefined;

	#open(): Promise<IDBPDatabase<Schema>> {
		this.#db ??= openDB<Schema>("indoorid-floorplans", 2, {
			// Each store is made if missing, whatever version the database says it is at.
			// Version 2 added "settings": the building outlines' place in the layer list.
			upgrade(db) {
				const stores = db.objectStoreNames;
				if (!stores.contains("plans")) {
					db.createObjectStore("plans", { keyPath: "id" });
				}
				if (!stores.contains("images")) db.createObjectStore("images");
				if (!stores.contains("settings")) db.createObjectStore("settings");
			},
		});
		return this.#db;
	}

	async load(): Promise<{ plan: StoredPlan; image: Blob }[]> {
		const db = await this.#open();
		const plans = await db.getAll("plans");
		const loaded = await Promise.all(
			plans.map(async (plan) => ({
				plan,
				image: await db.get("images", plan.id),
			})),
		);
		return loaded
			.filter(
				(p): p is { plan: StoredPlan; image: Blob } => p.image !== undefined,
			)
			.sort((a, b) => a.plan.order - b.plan.order);
	}

	async saveImage(id: string, image: Blob): Promise<void> {
		await (await this.#open()).put("images", image, id);
	}

	async save(plan: StoredPlan): Promise<void> {
		await (await this.#open()).put("plans", plan);
	}

	async loadBuildings(): Promise<StoredBuildings | undefined> {
		return (await this.#open()).get("settings", "buildings");
	}

	async saveBuildings(buildings: StoredBuildings): Promise<void> {
		await (await this.#open()).put("settings", buildings, "buildings");
	}

	async saveStack(
		plans: readonly StoredPlan[],
		buildings: StoredBuildings,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["plans", "settings"], "readwrite");
		await Promise.all([
			...plans.map((plan) => tx.objectStore("plans").put(plan)),
			tx.objectStore("settings").put(buildings, "buildings"),
			tx.done,
		]);
	}

	async delete(id: string): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(["plans", "images"], "readwrite");
		await Promise.all([
			tx.objectStore("plans").delete(id),
			tx.objectStore("images").delete(id),
			tx.done,
		]);
	}
}
