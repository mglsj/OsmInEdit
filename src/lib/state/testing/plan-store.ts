/** Floor plan tests: a store in memory and a codec without a browser. */
import type { PlanCodec } from "#lib/floorplans/codec.ts";
import type { PlanImage } from "#lib/floorplans/content.ts";
import type {
	PlanStore,
	StoredBuildings,
	StoredContent,
	StoredPlan,
} from "#lib/persist/plan-store.ts";

/** A store keeping the latest of each record, like IndexedDB, to restore from. */
export function memoryStore() {
	const plans = new Map<string, StoredPlan>();
	const contents = new Map<string, StoredContent>();
	const thumbnails = new Map<string, Blob>();
	/** Every plan saved, in order. */
	const saved: StoredPlan[] = [];
	let buildings: StoredBuildings | undefined;
	const store: PlanStore = {
		load: async () => [...plans.values()].sort((a, b) => a.order - b.order),
		loadContent: async (id) => contents.get(id),
		saveContent: async (id, content) => {
			contents.set(id, content);
			if (content.thumbnail) thumbnails.set(id, content.thumbnail);
		},
		loadThumbnails: async () => new Map(thumbnails),
		save: async (plan) => {
			plans.set(plan.id, plan);
			saved.push(plan);
		},
		delete: async (id) => {
			plans.delete(id);
			contents.delete(id);
			thumbnails.delete(id);
		},
		loadBuildings: async () => buildings,
		saveBuildings: async (b) => {
			buildings = b;
		},
		saveStack: async (stack, b) => {
			for (const plan of stack) plans.set(plan.id, plan);
			buildings = b;
		},
	};
	return { store, plans, contents, saved };
}

/** A bitmap stand-in: its size, and whether it was closed. */
export function fakeBitmap(width = 400, height = 300) {
	const bitmap = {
		width,
		height,
		closed: false,
		close() {
			bitmap.closed = true;
		},
	};
	return bitmap as unknown as ImageBitmap & { closed: boolean };
}

/** A 400 × 300 image in one tile, encoded as its size in text, with a thumbnail. */
export function fakeImage(blob = new Blob(["image"])): PlanImage {
	const tile = { x: 0, y: 0, width: 400, height: 300 };
	return {
		width: 400,
		height: 300,
		blob,
		levels: [{ scale: 1, tiles: [{ tile, bitmap: fakeBitmap() }] }],
		encoded: Promise.resolve({
			levels: [
				{ scale: 1, tiles: [{ tile, blob: new Blob(["tile 400×300"]) }] },
			],
			thumbnail: new Blob(["thumbnail"]),
		}),
	};
}

/** Every file is a 400 × 300 image; stored tiles decode into stand-in bitmaps. */
export const fakeCodec: PlanCodec = {
	decodeFile: async (file) => ({
		image: fakeImage(file),
		width: 400,
		height: 300,
	}),
	fromRendering: async () =>
		fakeImage(new Blob(["png"], { type: "image/png" })),
	decode: async () => fakeBitmap(),
};
