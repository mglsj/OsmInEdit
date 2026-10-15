import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";
import { place } from "#lib/floorplans/georef.ts";
import type { PlanImage } from "#lib/floorplans/import.ts";
import {
	distance,
	northUpPlan,
	offset,
	RENNES,
} from "#lib/floorplans/test-geometry.ts";
import type { FloorPlan, Tool } from "#lib/state/floorplans.svelte.ts";
import { toolFeatures } from "./floorplan-layers.ts";

/** A 400 × 300 px plan, north up at 5 cm per pixel, its top-left pixel at RENNES. */
const truth = northUpPlan(RENNES);
const image: PlanImage = {
	width: 400,
	height: 300,
	blob: new Blob(),
	levels: [],
};
const plan: FloorPlan = {
	id: "p",
	name: "plan",
	image,
	transform: place(
		{ center: truth(200, 150), metresPerPixel: 0.05, bearing: 0 },
		400,
		300,
	),
	controlPoints: [],
	fitKind: "similarity",
	opacity: 0.5,
	level: "0",
	visible: true,
};

function linesOf(tool: Tool, pointer?: [number, number]) {
	return toolFeatures(plan, tool, false, pointer)
		.features.filter((f) => f.geometry.type === "LineString")
		.map((f) => ({
			role: f.properties?.role,
			coordinates: (f.geometry as LineString).coordinates as [number, number][],
		}));
}

describe("toolFeatures, measuring", () => {
	it("draws a dashed line from the first measured spot to the pointer", () => {
		const pointer = offset(RENNES, 30, -5);
		const lines = linesOf({ kind: "measure", points: [[20, 40]] }, pointer);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.role).toBe("rubber");
		const [from, to] = lines[0]?.coordinates ?? [];
		if (!from || !to) throw new Error("No line");
		// Pixel (20, 40) is 1 m east and 2 m south of the top-left corner.
		expect(distance(from, offset(RENNES, 1, -2))).toBeLessThan(0.001);
		expect(to).toEqual(pointer);
	});

	it("draws nothing to follow the pointer before the first spot, or without a pointer", () => {
		expect(
			linesOf({ kind: "measure", points: [] }, offset(RENNES, 1, -1)),
		).toEqual([]);
		expect(linesOf({ kind: "measure", points: [[20, 40]] })).toEqual([]);
	});

	it("joins the two measured spots with a solid line, whatever the pointer does", () => {
		const lines = linesOf(
			{
				kind: "measure",
				points: [
					[20, 40],
					[380, 40],
				],
			},
			offset(RENNES, 30, -5),
		);

		expect(lines).toHaveLength(1);
		expect(lines[0]?.role).toBe("measured");
		const [from, to] = lines[0]?.coordinates ?? [];
		if (!from || !to) throw new Error("No line");
		expect(distance(from, offset(RENNES, 1, -2))).toBeLessThan(0.001);
		// 360 px further east: 18 m.
		expect(distance(to, offset(RENNES, 19, -2))).toBeLessThan(0.001);
	});
});
