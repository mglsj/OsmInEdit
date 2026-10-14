import { describe, expect, it } from "vitest";
import { tileBounds, tilesCovering } from "./tiles.ts";

describe("tilesCovering", () => {
	it("splits the world into four tiles at zoom 1", () => {
		expect(
			tilesCovering({ west: -90, south: 40, east: -80, north: 45 }, 1),
		).toEqual([{ x: 0, y: 0, z: 1 }]);
		expect(
			tilesCovering({ west: 80, south: -45, east: 90, north: -40 }, 1),
		).toEqual([{ x: 1, y: 1, z: 1 }]);
	});

	it("returns one tile for an area inside it", () => {
		const tile = { x: 33196, y: 22548, z: 16 };
		const b = tileBounds(tile);
		const inner = {
			west: b.west + 0.001,
			south: b.south + 0.001,
			east: b.east - 0.001,
			north: b.north - 0.001,
		};
		expect(tilesCovering(inner, 16)).toEqual([tile]);
	});

	it("returns exactly the tile whose bounds are given, not its neighbours", () => {
		const tile = { x: 33196, y: 22548, z: 16 };
		expect(tilesCovering(tileBounds(tile), 16)).toEqual([tile]);
	});

	it("covers an area across tile borders", () => {
		const a = tileBounds({ x: 10, y: 20, z: 16 });
		const d = tileBounds({ x: 11, y: 21, z: 16 });
		const area = {
			west: a.east - 0.0001,
			north: a.south + 0.0001,
			east: d.west + 0.0001,
			south: d.north - 0.0001,
		};
		expect(tilesCovering(area, 16)).toEqual([
			{ x: 10, y: 20, z: 16 },
			{ x: 11, y: 20, z: 16 },
			{ x: 10, y: 21, z: 16 },
			{ x: 11, y: 21, z: 16 },
		]);
	});
});

describe("tileBounds", () => {
	it("gives the bounds of a tile, adjacent to its neighbours", () => {
		expect(tileBounds({ x: 0, y: 0, z: 1 })).toMatchObject({
			west: -180,
			east: 0,
		});
		const left = tileBounds({ x: 10, y: 20, z: 16 });
		const right = tileBounds({ x: 11, y: 20, z: 16 });
		const below = tileBounds({ x: 10, y: 21, z: 16 });
		expect(left.east).toBeCloseTo(right.west, 12);
		expect(left.south).toBeCloseTo(below.north, 12);
		expect(left.north).toBeGreaterThan(left.south);
	});

	it("reaches the Web Mercator latitude limit at the top of the world", () => {
		expect(tileBounds({ x: 0, y: 0, z: 0 }).north).toBeCloseTo(85.0511, 4);
	});
});
