import { describe, expect, it } from "vitest";
import type { PlanImage } from "#lib/floorplans/import.ts";
import { offset, RENNES } from "#lib/floorplans/test-geometry.ts";
import { FloorPlans } from "./floorplans.svelte.ts";

const image: PlanImage = {
	width: 400,
	height: 300,
	blob: new Blob(),
	levels: [],
};

/**
 * A 400 × 300 px plan added in a 25 m tall view centred on RENNES: north up, 15 m tall, so 5 cm
 * per pixel, its top-left pixel 10 m west and 7.5 m north of RENNES.
 */
function withPlan() {
	const floorplans = new FloorPlans();
	floorplans.add(image, "plan", { center: RENNES, heightMetres: 25 }, "0");
	return floorplans;
}

describe("FloorPlans.clearPoints", () => {
	it("removes every control point, leaving the plan where they put it", () => {
		const floorplans = withPlan();
		floorplans.setTool("points");
		// Pixel (20, 20) to 2 m further west, which moves the plan; then pixel (380, 280), now
		// at 7 m east, 6.5 m south, stays there.
		floorplans.click(offset(RENNES, -9, 6.5));
		floorplans.click(offset(RENNES, -11, 6.5));
		floorplans.click(offset(RENNES, 7, -6.5));
		floorplans.click(offset(RENNES, 7, -6.5));
		const placed = floorplans.selected?.transform;
		expect(floorplans.selected?.controlPoints).toHaveLength(2);

		floorplans.clearPoints();

		expect(floorplans.selected?.controlPoints).toEqual([]);
		expect(floorplans.selected?.transform).toEqual(placed);
		expect(floorplans.tool).toEqual({ kind: "points", pending: null });
	});

	it("drops a half-done pick: a pending control point, measured spots, the rotation pin", () => {
		const floorplans = withPlan();
		const onPlan = offset(RENNES, 0, 0);
		const placed = floorplans.selected?.transform;

		floorplans.setTool("points");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "points", pending: null });

		floorplans.setTool("measure");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "measure", points: [] });

		floorplans.setTool("rotate");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "rotate", pin: null });
		expect(floorplans.selected?.transform).toBe(placed);
	});
});
