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
	/** Drawing order, lowest first. */
	readonly order: number;
}

/** Where plans are saved; an interface so that state can run without IndexedDB. */
export interface PlanStore {
	/** Saved plans with their images, in drawing order. */
	load(): Promise<{ plan: StoredPlan; image: Blob }[]>;
	saveImage(id: string, image: Blob): Promise<void>;
	save(plan: StoredPlan): Promise<void>;
	delete(id: string): Promise<void>;
}

interface Schema extends DBSchema {
	plans: { key: string; value: StoredPlan };
	images: { key: string; value: Blob };
}

export class IndexedDbPlanStore implements PlanStore {
	#db: Promise<IDBPDatabase<Schema>> | undefined;

	#open(): Promise<IDBPDatabase<Schema>> {
		this.#db ??= openDB<Schema>("indoorid-floorplans", 1, {
			upgrade(db) {
				db.createObjectStore("plans", { keyPath: "id" });
				db.createObjectStore("images");
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
