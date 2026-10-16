import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { rasterContent } from "#lib/floorplans/content.ts";
import { type Pixel, project } from "#lib/floorplans/georef.ts";
import { distance, offset, RENNES } from "#lib/floorplans/test-geometry.ts";
import { FloorPlans } from "#lib/state/floorplans.svelte.ts";
import { fakeImage } from "#lib/state/testing/plan-store.ts";
import PlanTools from "./PlanTools.svelte";

/**
 * A 400 × 300 px plan in Edit, added north up in a 25 m tall view centred on RENNES: 15 m tall,
 * 5 cm per pixel, its centre pixel (200, 150) on RENNES.
 */
function renderTools() {
	const floorplans = new FloorPlans();
	floorplans.add(
		rasterContent(fakeImage()),
		"Ground",
		{ center: RENNES, heightMetres: 25 },
		"0",
		{ source: { kind: "raster", file: "f" }, file: new Blob() },
	);
	render(PlanTools, { props: { floorplans, toolMessage: null } });
	const plan = () => {
		if (!floorplans.editing) throw new Error("no plan in Edit");
		return floorplans.editing;
	};
	/** Where a pixel of the plan was when it was added. */
	const at = ([u, v]: Pixel) =>
		offset(RENNES, 0.05 * (u - 200), 0.05 * (150 - v));
	/** Where a pixel of the plan is now. */
	const now = (pixel: Pixel) => project(plan().transform, pixel);
	return { floorplans, plan, at, now };
}

describe("PlanTools", () => {
	it("scales the plan so two measured spots are their real distance apart", async () => {
		const { floorplans, at, now } = renderTools();
		await page.getByRole("radio", { name: "Measure" }).click();
		floorplans.click(at([20, 20]));
		floorplans.click(at([220, 20]));
		await page
			.getByRole("spinbutton", { name: "Real distance (m)" })
			.fill("20");
		await page.getByRole("button", { name: "Scale" }).click();
		// 10 m apart before.
		expect(distance(now([20, 20]), now([220, 20]))).toBeCloseTo(20, 3);
		expect(floorplans.tool).toEqual({ kind: "measure", points: [] });
	});

	it("turns the plan clockwise around a picked spot", async () => {
		const { floorplans, at, now } = renderTools();
		await page.getByRole("radio", { name: "Rotate" }).click();
		floorplans.click(at([200, 150]));
		await page.getByRole("spinbutton", { name: /Angle/ }).fill("90");
		await page.getByRole("button", { name: "Rotate", exact: true }).click();
		// The pin stays; the spot 10 m east of it is now 10 m south.
		expect(distance(now([200, 150]), RENNES)).toBeCloseTo(0, 3);
		expect(distance(now([400, 150]), offset(RENNES, 0, -10))).toBeCloseTo(0, 3);
	});

	it("lists control points with their residuals, removes one, and changes the fit", async () => {
		const { floorplans, plan, at } = renderTools();
		await page.getByRole("radio", { name: "Control points" }).click();
		const spots: Pixel[] = [
			[20, 20],
			[380, 280],
		];
		for (const pixel of spots) {
			floorplans.click(at(pixel));
			floorplans.click(at(pixel));
		}
		const points = page.getByRole("list", { name: "Control points" });
		await expect.poll(() => points.getByRole("listitem").all()).toHaveLength(2);
		await expect
			.element(points.getByRole("listitem").first())
			.toHaveTextContent("1 0.00 m");

		await page.getByRole("radio", { name: "Affine" }).click();
		expect(plan().fitKind).toBe("affine");
		await expect
			.element(
				page.getByText("Needs 3 points; until then the plan keeps its shape."),
			)
			.toBeVisible();

		await page.getByRole("button", { name: "Remove control point 1" }).click();
		expect(plan().controlPoints).toHaveLength(1);
		await expect
			.element(points.getByRole("listitem"))
			.toHaveTextContent("1 Moves the plan");
	});

	it("keeps the plan's changes with Done, puts it back with Cancel", async () => {
		const { floorplans } = renderTools();
		const id = floorplans.editingId;
		await page.getByRole("textbox", { name: "Level" }).fill("2");
		await userEvent.keyboard("{Enter}");
		await page.getByRole("button", { name: "Cancel" }).click();
		expect(floorplans.plans[0]?.level).toBe("0");
		expect(floorplans.editingId).toBeNull();
		await expect.element(page.getByRole("region")).not.toBeInTheDocument();

		floorplans.edit(id ?? "");
		await page.getByRole("textbox", { name: "Level" }).fill("2");
		await userEvent.keyboard("{Enter}");
		await page.getByRole("button", { name: "Done" }).click();
		expect(floorplans.plans[0]?.level).toBe("2");
		expect(floorplans.editingId).toBeNull();
	});
});
