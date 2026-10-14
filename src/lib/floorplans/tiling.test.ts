import { describe, expect, it } from "vitest";
import { type LngLat, place } from "./georef.ts";
import { distance, offset, RENNES } from "./test-geometry.ts";
import { tileCorners, tiles } from "./tiling.ts";

describe("tiles", () => {
	it("keeps a plan that fits in one texture whole", () => {
		expect(tiles(1600, 1200)).toEqual([
			{ x: 0, y: 0, width: 1600, height: 1200 },
		]);
	});

	it("splits a large plan into tiles of at most 2048 px, row by row", () => {
		expect(tiles(5000, 3000)).toEqual([
			{ x: 0, y: 0, width: 2048, height: 2048 },
			{ x: 2048, y: 0, width: 2048, height: 2048 },
			{ x: 4096, y: 0, width: 904, height: 2048 },
			{ x: 0, y: 2048, width: 2048, height: 952 },
			{ x: 2048, y: 2048, width: 2048, height: 952 },
			{ x: 4096, y: 2048, width: 904, height: 952 },
		]);
	});
});

describe("tileCorners", () => {
	// 5000 × 3000 px at 5 cm per pixel, north up: 250 × 150 m.
	const transform = place(
		{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
		5000,
		3000,
	);
	const topLeft = offset(RENNES, -125, 75);

	it("places each tile where its pixels are on the plan", () => {
		const [, second] = tiles(5000, 3000);
		if (!second) throw new Error("No second tile");
		// The second tile starts 2048 px × 5 cm = 102.4 m right of the plan's left edge.
		const expected: LngLat[] = [
			offset(topLeft, 102.4, 0),
			offset(topLeft, 204.8, 0),
			offset(topLeft, 204.8, -102.4),
			offset(topLeft, 102.4, -102.4),
		];
		// Over 100 m, Mercator's scale drifts by ~1e-5 from the flat offsets above: allow 1 cm.
		tileCorners(transform, second).forEach((corner, i) => {
			expect(distance(corner, expected[i] as LngLat)).toBeLessThan(0.01);
		});
	});

	it("leaves no gap between neighbouring tiles", () => {
		const [first, second] = tiles(5000, 3000).map((tile) =>
			tileCorners(transform, tile),
		);
		expect(second?.[0]).toEqual(first?.[1]);
		expect(second?.[3]).toEqual(first?.[2]);
	});
});
