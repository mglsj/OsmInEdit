/**
 * Downloads OSM data for the visible area in zoom-16 tiles: each tile once, a few at a time,
 * so panning back and forth never downloads the same data twice.
 */
import { type Tile, tileBounds, tilesCovering } from "#lib/map/tiles.ts";
import type { Entity } from "#lib/osm/entity.ts";
import type { Bbox } from "./osm-api.ts";

export interface MapLoaderOptions {
	/** Downloads one area, e.g. `(bbox) => api.loadMap(bbox)`. */
	readonly download: (bbox: Bbox) => Promise<Entity[]>;
	/** Receives the entities of each downloaded tile. */
	readonly onData: (entities: Entity[]) => void;
	readonly zoom?: number;
	readonly concurrency?: number;
	/** Areas needing more tiles are skipped: the view is zoomed out too far. */
	readonly maxTiles?: number;
}

export interface LoadResult {
	/** Tiles that failed; they are retried on the next load. */
	readonly failed: number;
	/** True when the area was too large to load. */
	readonly skipped: boolean;
}

export class MapLoader {
	readonly #options: Required<MapLoaderOptions>;
	readonly #loaded = new Set<string>();
	readonly #pending = new Map<string, Promise<boolean>>();
	readonly #waiting: (() => void)[] = [];
	#active = 0;

	constructor(options: MapLoaderOptions) {
		this.#options = { zoom: 16, concurrency: 4, maxTiles: 64, ...options };
	}

	async load(bounds: Bbox): Promise<LoadResult> {
		const tiles = tilesCovering(bounds, this.#options.zoom);
		if (tiles.length > this.#options.maxTiles)
			return { failed: 0, skipped: true };
		const results = await Promise.all(
			tiles.map((tile) => this.#loadTile(tile)),
		);
		return { failed: results.filter((ok) => !ok).length, skipped: false };
	}

	#loadTile(tile: Tile): Promise<boolean> {
		const key = `${tile.z}/${tile.x}/${tile.y}`;
		if (this.#loaded.has(key)) return Promise.resolve(true);
		const pending = this.#pending.get(key);
		if (pending) return pending;

		const loading = this.#limited(() =>
			this.#options.download(tileBounds(tile)),
		)
			.then(
				(entities) => {
					this.#loaded.add(key);
					this.#options.onData(entities);
					return true;
				},
				() => false,
			)
			.finally(() => this.#pending.delete(key));
		this.#pending.set(key, loading);
		return loading;
	}

	/** Runs `task` once fewer than `concurrency` tasks are running. */
	async #limited<T>(task: () => Promise<T>): Promise<T> {
		if (this.#active >= this.#options.concurrency) {
			await new Promise<void>((resolve) => this.#waiting.push(resolve));
		}
		this.#active++;
		try {
			return await task();
		} finally {
			this.#active--;
			this.#waiting.shift()?.();
		}
	}
}
