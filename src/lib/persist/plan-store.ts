/**
 * Floor plans kept in the browser's IndexedDB, so they survive reloads. Settings, content and
 * thumbnails are stored apart: settings change with every slider move, content is written once
 * and read only for the plans shown, thumbnails are read for the list. Nothing leaves the
 * user's browser.
 *
 * Schema 3: `plans` (settings), `rasters` (a plan's raster: unit, size, the tiles of each
 * pyramid level), `tiles` (`[plan, level, x, y]` → the encoded tile), `originals` (the file
 * imported), `thumbnails`, `settings` (the building outlines' place). `images` holds the whole
 * images of schemas 1 and 2 until each plan is converted, the first time its content loads.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { PlanSize } from "#lib/floorplans/content.ts";
import type {
	ControlPoint,
	Transform,
	TransformKind,
} from "#lib/floorplans/georef.ts";
import type { Tile } from "#lib/floorplans/tiling.ts";

/** A plan's settings: everything but its content. */
export interface StoredPlan {
	readonly id: string;
	readonly name: string;
	/** Size in plan units; plans saved before plan units have none (their image's pixels). */
	readonly size?: PlanSize;
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

/** A raster as stored: each pyramid level's tiles, encoded, placed in full-size pixels. */
export interface StoredRaster {
	/** Plan units per pixel of the full-size image. */
	readonly unit: number;
	readonly width: number;
	readonly height: number;
	readonly levels: readonly {
		/** Image pixels per pixel of this level: 1, 2, 4… */
		readonly scale: number;
		readonly tiles: readonly { readonly tile: Tile; readonly blob: Blob }[];
	}[];
}

/** A plan's content as stored, or the whole image a plan saved before schema 3 still has. */
export type StoredContent =
	| {
			readonly kind: "raster";
			readonly raster: StoredRaster;
			/** The file imported (a PDF, an SVG, a photo), for exports. */
			readonly original?: Blob;
			readonly thumbnail?: Blob;
	  }
	| { readonly kind: "legacy"; readonly image: Blob };

/** Where plans are saved; an interface so that state can run without IndexedDB. */
export interface PlanStore {
	/** Saved plans' settings, in drawing order. */
	load(): Promise<StoredPlan[]>;
	/** A plan's content; undefined when it has none (saving failed). */
	loadContent(id: string): Promise<StoredContent | undefined>;
	/** Writes a plan's content, replacing any (an old image included). */
	saveContent(
		id: string,
		content: Extract<StoredContent, { kind: "raster" }>,
	): Promise<void>;
	/** Every plan's thumbnail, by id. */
	loadThumbnails(): Promise<Map<string, Blob>>;
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

/** A raster's description as stored, its tiles apart. */
interface RasterRecord {
	readonly unit: number;
	readonly width: number;
	readonly height: number;
	readonly levels: readonly { scale: number; tiles: readonly Tile[] }[];
}

type TileKey = [plan: string, level: number, x: number, y: number];

interface Schema extends DBSchema {
	plans: { key: string; value: StoredPlan };
	rasters: { key: string; value: RasterRecord };
	tiles: { key: TileKey; value: Blob };
	originals: { key: string; value: Blob };
	thumbnails: { key: string; value: Blob };
	settings: { key: string; value: StoredBuildings };
	/** Schemas 1 and 2: whole images, until converted. */
	images: { key: string; value: Blob };
}

/** Every tile key of a plan: arrays sort after numbers, so `[id, []]` is past them all. */
const tilesOf = (id: string) => IDBKeyRange.bound([id], [id, []]);

const CONTENT_STORES = [
	"rasters",
	"tiles",
	"originals",
	"thumbnails",
	"images",
] as const;

export class IndexedDbPlanStore implements PlanStore {
	readonly #name: string;
	#db: Promise<IDBPDatabase<Schema>> | undefined;

	constructor(name = "indoorid-floorplans") {
		this.#name = name;
	}

	#open(): Promise<IDBPDatabase<Schema>> {
		this.#db ??= openDB<Schema>(this.#name, 3, {
			// Each store is made if missing, whatever version the database says it is at:
			// version 2 added "settings", version 3 the content stores. "images" stays for the
			// plans not converted yet.
			upgrade(db) {
				const stores = db.objectStoreNames;
				if (!stores.contains("plans")) {
					db.createObjectStore("plans", { keyPath: "id" });
				}
				for (const store of [
					"images",
					"settings",
					"rasters",
					"tiles",
					"originals",
					"thumbnails",
				] as const) {
					if (!stores.contains(store)) db.createObjectStore(store);
				}
			},
		});
		return this.#db;
	}

	async load(): Promise<StoredPlan[]> {
		const plans = await (await this.#open()).getAll("plans");
		return plans.sort((a, b) => a.order - b.order);
	}

	async loadContent(id: string): Promise<StoredContent | undefined> {
		const db = await this.#open();
		const tx = db.transaction(
			["rasters", "tiles", "originals", "thumbnails", "images"],
			"readonly",
		);
		const record = await tx.objectStore("rasters").get(id);
		if (!record) {
			const image = await tx.objectStore("images").get(id);
			return image ? { kind: "legacy", image } : undefined;
		}
		const tiles = tx.objectStore("tiles");
		const levels = await Promise.all(
			record.levels.map(async ({ scale, tiles: placed }, level) => ({
				scale,
				tiles: await Promise.all(
					placed.map(async (tile) => ({
						tile,
						blob: (await tiles.get([id, level, tile.x, tile.y])) ?? new Blob(),
					})),
				),
			})),
		);
		const [original, thumbnail] = await Promise.all([
			tx.objectStore("originals").get(id),
			tx.objectStore("thumbnails").get(id),
		]);
		return {
			kind: "raster",
			raster: { ...record, levels },
			...(original ? { original } : {}),
			...(thumbnail ? { thumbnail } : {}),
		};
	}

	async saveContent(
		id: string,
		{ raster, original, thumbnail }: Extract<StoredContent, { kind: "raster" }>,
	): Promise<void> {
		const db = await this.#open();
		const tx = db.transaction(CONTENT_STORES, "readwrite");
		const writes: Promise<unknown>[] = [
			tx.objectStore("tiles").delete(tilesOf(id)),
			tx.objectStore("images").delete(id),
			tx.objectStore("rasters").put(
				{
					unit: raster.unit,
					width: raster.width,
					height: raster.height,
					levels: raster.levels.map(({ scale, tiles }) => ({
						scale,
						tiles: tiles.map(({ tile }) => tile),
					})),
				},
				id,
			),
		];
		raster.levels.forEach(({ tiles }, level) => {
			for (const { tile, blob } of tiles) {
				writes.push(
					tx.objectStore("tiles").put(blob, [id, level, tile.x, tile.y]),
				);
			}
		});
		if (original) writes.push(tx.objectStore("originals").put(original, id));
		if (thumbnail) writes.push(tx.objectStore("thumbnails").put(thumbnail, id));
		await Promise.all([...writes, tx.done]);
	}

	async loadThumbnails(): Promise<Map<string, Blob>> {
		const db = await this.#open();
		const tx = db.transaction("thumbnails", "readonly");
		const [keys, values] = await Promise.all([
			tx.store.getAllKeys(),
			tx.store.getAll(),
		]);
		return new Map(keys.map((key, i) => [key, values[i] as Blob]));
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
		const tx = db.transaction(["plans", ...CONTENT_STORES], "readwrite");
		await Promise.all([
			tx.objectStore("plans").delete(id),
			tx.objectStore("tiles").delete(tilesOf(id)),
			...(["rasters", "originals", "thumbnails", "images"] as const).map(
				(store) => tx.objectStore(store).delete(id),
			),
			tx.done,
		]);
	}
}
