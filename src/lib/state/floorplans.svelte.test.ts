import { describe, expect, it } from "vitest";
import { PLAN_COLORS } from "#lib/floorplans/colors.ts";
import { place } from "#lib/floorplans/georef.ts";
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

describe("plan colours", () => {
	it("gives each new plan a colour no other plan has", () => {
		const floorplans = new FloorPlans();
		const view = { center: RENNES, heightMetres: 25 };
		for (let i = 0; i < PLAN_COLORS.length; i++) {
			floorplans.add(image, `plan ${i}`, view, "0");
		}
		const colors = floorplans.plans.map((p) => p.color);
		expect(new Set(colors).size).toBe(PLAN_COLORS.length);
		for (const c of colors) {
			expect(PLAN_COLORS.map((p) => p.value)).toContain(c);
		}
	});

	it("keeps the colour a plan file gives, and gives one to plans without", () => {
		const floorplans = new FloorPlans();
		const fields = {
			name: "plan",
			image,
			transform: place(
				{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
				400,
				300,
			),
			controlPoints: [],
			fitKind: "similarity" as const,
			opacity: 0.5,
			level: "0",
			visible: true,
		};
		floorplans.insert({ ...fields, color: "#16a34a" });
		floorplans.insert(fields);
		const [kept, given] = floorplans.plans;
		expect(kept?.color).toBe("#16a34a");
		expect(given?.color).not.toBe("#16a34a");
		expect(PLAN_COLORS.map((p) => p.value)).toContain(given?.color);
	});

	it("gives plans saved before colours existed one when they come back", async () => {
		const stored = {
			id: "old",
			name: "old plan",
			transform: place(
				{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
				400,
				300,
			),
			controlPoints: [],
			fitKind: "similarity" as const,
			opacity: 0.5,
			level: "0",
			visible: true,
			order: 0,
		};
		const floorplans = new FloorPlans({
			store: {
				load: async () => [{ plan: stored, image: new Blob() }],
				saveImage: async () => {},
				save: async () => {},
				delete: async () => {},
			},
			decode: async () => image,
		});
		await floorplans.restore();
		expect(PLAN_COLORS.map((p) => p.value)).toContain(
			floorplans.plans[0]?.color,
		);
	});

	it("changes a plan's colour", () => {
		const floorplans = withPlan();
		const id = floorplans.selected?.id ?? "";
		floorplans.update(id, { color: "#78350f" });
		expect(floorplans.selected?.color).toBe("#78350f");
	});
});
