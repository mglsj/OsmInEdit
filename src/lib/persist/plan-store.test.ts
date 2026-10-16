import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { place } from "#lib/floorplans/georef.ts";
import { RENNES } from "#lib/floorplans/test-geometry.ts";
import {
	IndexedDbPlanStore,
	type StoredContent,
	type StoredPlan,
} from "./plan-store.ts";

let name = "";
let count = 0;
afterEach(() => indexedDB.deleteDatabase(name));
/** A store on a database of its own. */
function freshStore() {
	name = `plans-test-${count++}`;
	return new IndexedDbPlanStore(name);
}

const transform = place(
	{ center: RENNES, metresPerPixel: 0.1, bearing: 0 },
	595,
	842,
);

const plan = (id: string, order: number): StoredPlan => ({
	id,
	name: `Plan ${id}`,
	size: { width: 595, height: 842 },
	transform,
	controlPoints: [],
	fitKind: "similarity",
	opacity: 0.5,
	level: "0",
	visible: true,
	color: "#2563eb",
	order,
});

const text = (blob: Blob | undefined) => blob?.text();

/** A raster of two levels: the full image in two tiles, then one halved tile. */
const content: StoredContent = {
	kind: "raster",
	raster: {
		unit: 0.48,
		width: 1240,
		height: 1754,
		levels: [
			{
				scale: 1,
				tiles: [
					{
						tile: { x: 0, y: 0, width: 1024, height: 1754 },
						blob: new Blob(["0-0"]),
					},
					{
						tile: { x: 1024, y: 0, width: 216, height: 1754 },
						blob: new Blob(["0-1"]),
					},
				],
			},
			{
				scale: 2,
				tiles: [
					{
						tile: { x: 0, y: 0, width: 1240, height: 1754 },
						blob: new Blob(["1-0"]),
					},
				],
			},
		],
	},
	original: new Blob(["%PDF"]),
	thumbnail: new Blob(["thumb"]),
};

describe("IndexedDbPlanStore (schema 3)", () => {
	it("restores plans without their content, in their order", async () => {
		const store = freshStore();
		await store.save(plan("b", 1));
		await store.save(plan("a", 0));
		await store.saveContent("a", content);
		const plans = await store.load();
		expect(plans.map((p) => p.id)).toEqual(["a", "b"]);
		expect(plans[0]).toEqual(plan("a", 0));
	});

	it("gives a plan's content when asked: tiles by level, in place, with the original", async () => {
		const store = freshStore();
		await store.save(plan("a", 0));
		await store.saveContent("a", content);
		const loaded = await store.loadContent("a");
		if (loaded?.kind !== "raster") throw new Error("no raster");
		const { raster } = loaded;
		expect([raster.unit, raster.width, raster.height]).toEqual([
			0.48, 1240, 1754,
		]);
		expect(raster.levels.map((l) => l.scale)).toEqual([1, 2]);
		expect(raster.levels[0]?.tiles.map((t) => t.tile.x)).toEqual([0, 1024]);
		expect(
			await Promise.all(
				raster.levels.flatMap((l) => l.tiles.map((t) => text(t.blob))),
			),
		).toEqual(["0-0", "0-1", "1-0"]);
		expect(await text(loaded.original)).toBe("%PDF");
		expect(await text(loaded.thumbnail)).toBe("thumb");
		expect(await store.loadThumbnails()).toEqual(
			new Map([["a", expect.any(Blob)]]),
		);
	});

	it("deletes a plan with all its content", async () => {
		const store = freshStore();
		await store.save(plan("a", 0));
		await store.saveContent("a", content);
		await store.delete("a");
		expect(await store.load()).toEqual([]);
		expect(await store.loadContent("a")).toBeUndefined();
		expect((await store.loadThumbnails()).size).toBe(0);
	});

	it("upgrades a version 2 database: its plans load, their images as legacy content", async () => {
		name = `plans-test-${count++}`;
		const v2 = await openDB(name, 2, {
			upgrade(db) {
				db.createObjectStore("plans", { keyPath: "id" });
				db.createObjectStore("images");
				db.createObjectStore("settings");
			},
		});
		const { size: _, ...old } = plan("a", 0);
		await v2.put("plans", old);
		await v2.put("images", new Blob(["png"]), "a");
		await v2.put("settings", { order: 1, visible: false }, "buildings");
		v2.close();

		const store = new IndexedDbPlanStore(name);
		expect((await store.load()).map((p) => [p.id, p.size])).toEqual([
			["a", undefined],
		]);
		expect(await store.loadBuildings()).toEqual({ order: 1, visible: false });
		const legacy = await store.loadContent("a");
		expect(legacy?.kind).toBe("legacy");
		expect(
			await text(legacy?.kind === "legacy" ? legacy.image : undefined),
		).toBe("png");

		// Converted once loaded: the image goes.
		await store.saveContent("a", content);
		expect((await store.loadContent("a"))?.kind).toBe("raster");
	});
});
