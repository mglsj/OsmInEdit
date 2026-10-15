import path from "node:path";
import type { Page } from "@playwright/test";
import {
	BACKGROUND,
	blend,
	expect,
	expectPixel,
	LAT,
	LON,
	mapLocator,
	pixelAt,
	room,
	serveOsm,
	test,
} from "./fixtures.ts";

const FILES = path.join(import.meta.dirname, "files");
const RED: [number, number, number] = [255, 0, 0];
/** Colour of building outlines in floor plan mode. */
const BUILDING_OUTLINE: [number, number, number] = [0xd6, 0x24, 0x9f];

/** Opens the floor plans panel and imports a file from tests/e2e/files. */
async function importPlan(page: Page, file: string) {
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await page
		.getByLabel("Import a floor plan")
		.setInputFiles(path.join(FILES, file));
}

/**
 * Where new plans go: the middle of the map beside the floor plan side panel. `mx` is the map's
 * own centre, (LON, LAT); `scale`, the screen pixels a plan pixel `planHeight` tall takes.
 */
async function initialLayout(page: Page, planHeight: number) {
	const box = await mapLocator(page).boundingBox();
	const panel = await page
		.getByRole("complementary", { name: "Floor plan editor" })
		.boundingBox();
	if (!box || !panel) throw new Error("No map or floor plan panel");
	const left = panel.x + panel.width;
	return {
		cx: (left + box.x + box.width) / 2,
		cy: box.y + box.height / 2,
		mx: box.x + box.width / 2,
		scale: (box.height * 0.6) / planHeight,
	};
}

/**
 * Checks that a plan of the given aspect ratio is drawn where new plans go, 60% of the map tall,
 * in `color` at opacity 0.5: pixels just inside its edges are blended, just outside not.
 */
async function expectPlanDrawn(
	page: Page,
	color: [number, number, number],
	aspect: number,
) {
	const { cx, cy, scale } = await initialLayout(page, 1);
	const height = scale;
	const width = height * aspect;
	const plan = blend(color, 0.5, BACKGROUND);

	await expectPixel(page, cx, cy, plan);
	await expectPixel(page, cx - width * 0.45, cy, plan);
	await expectPixel(page, cx + width * 0.45, cy, plan);
	await expectPixel(page, cx, cy - height * 0.45, plan);
	await expectPixel(page, cx, cy + height * 0.45, plan);
	await expectPixel(page, cx - width * 0.55, cy, BACKGROUND);
	await expectPixel(page, cx + width * 0.55, cy, BACKGROUND);
	await expectPixel(page, cx, cy - height * 0.55, BACKGROUND);
	await expectPixel(page, cx, cy + height * 0.55, BACKGROUND);
}

for (const file of ["plan.png", "plan.jpg", "plan.webp"]) {
	test(`imports a ${path.extname(file)} plan over the map`, async ({
		page,
	}) => {
		await importPlan(page, file);
		await expect(
			page.getByRole("list", { name: "Floor plans" }).getByRole("listitem"),
		).toContainText(["plan 400 × 300 px"]);
		await expectPlanDrawn(page, RED, 4 / 3);
	});
}

test("imports an SVG plan without running its scripts", async ({ page }) => {
	await importPlan(page, "plan.svg");
	await expectPlanDrawn(page, [0, 255, 0], 4 / 3);
	expect(await page.evaluate(() => "svgRan" in window)).toBe(false);
});

test("imports the chosen page of a PDF at the chosen resolution", async ({
	page,
}) => {
	await importPlan(page, "plan.pdf");

	const dialog = page.getByRole("dialog", { name: "Import a PDF page" });
	const pages = dialog.getByRole("radio");
	await expect(pages).toHaveCount(2);
	await expect(dialog.getByLabel("Resolution (DPI)")).toHaveValue("150");
	await dialog.getByRole("radio", { name: "Page 2" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();

	// 4 × 3 inches at 150 DPI.
	await expect(
		page.getByRole("list", { name: "Floor plans" }).getByRole("listitem"),
	).toContainText(["plan, page 2 600 × 450 px"]);
	await expectPlanDrawn(page, [0, 0, 255], 4 / 3);
});

test("floor plan mode shows only building outlines, without selection", async ({
	page,
}) => {
	// A room inside a mall 0.0008° (~600 px at zoom 19) wide, tagged as the one in Rennes.
	const building = room(200, LON, LAT, "0", 0.0004).map((e) =>
		e.type === "way"
			? { ...e, tags: { building: "retail", shop: "mall", name: "Mall" } }
			: e,
	);
	await serveOsm(page, [...room(100, LON, LAT, "0"), ...building]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const editor = page.getByRole("complementary", { name: "Feature editor" });
	await expect(async () => {
		await page.mouse.click(centre.x, centre.y);
		await expect(editor).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 10_000 });
	const editing = await pixelAt(page, centre.x, centre.y);

	// The feature editor and the floor plan editor take turns in the side panel, on the left.
	const editorBox = await editor.boundingBox();
	expect(editorBox?.x).toBe(box.x);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(editor).toBeHidden();
	const planEditor = page.getByRole("complementary", {
		name: "Floor plan editor",
	});
	await expect(planEditor).toBeVisible();
	expect((await planEditor.boundingBox())?.x).toBe(box.x);
	await expect(page.getByRole("group", { name: "Edit history" })).toBeHidden();
	// Rooms and fills are hidden; the building's outline is drawn ~298 px right of the centre.
	await expectPixel(page, centre.x, centre.y, BACKGROUND);
	await expectPixel(page, centre.x + 298, centre.y, BUILDING_OUTLINE, 40);
	// Clicking a room selects nothing.
	await page.mouse.click(centre.x, centre.y);
	await expect(editor).toBeHidden();

	await page.getByRole("button", { name: "Done" }).click();
	await expect(planEditor).toBeHidden();
	await expect(page.getByRole("group", { name: "Edit history" })).toBeVisible();
	await expectPixel(page, centre.x, centre.y, editing);
});

test("draws a plan over the rooms already mapped", async ({ page }) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await importPlan(page, "plan.png");
	// The plan, ~540 px wide, covers the room in the map's centre.
	const { mx, cy } = await initialLayout(page, 300);
	await page.getByRole("button", { name: "Done" }).click();
	// Back to editing: the room's fill (80% opaque), then the plan at half opacity on top.
	const roomFill = blend([0xd6, 0xd1, 0xc7], 0.8, BACKGROUND);
	await expectPixel(page, mx, cy, blend(RED, 0.5, roomFill));
});

test("keeps the fine lines of a large plan when it is shown small", async ({
	page,
}) => {
	// 4000 × 3000 px of alternating 1 px black and white columns, shown ~400 px tall: each
	// screen pixel covers several columns and should average them to mid-grey everywhere.
	await importPlan(page, "stripes.png");
	const { cx, cy } = await initialLayout(page, 3000);
	const grey = blend([128, 128, 128], 0.5, BACKGROUND);
	for (const dx of [-150, -97, -41, 0, 23, 71, 133]) {
		await expectPixel(page, cx + dx, cy, grey, 12);
	}
});

/** Size of the world at zoom 19, in screen pixels (MapLibre tiles are 512 px). */
const WORLD = 512 * 2 ** 19;

/** The [lon, lat] shown `dx`, `dy` screen pixels from the map centre (LON, LAT) at zoom 19. */
function lngLatAt(dx: number, dy: number): [number, number] {
	const phi = (LAT * Math.PI) / 180;
	const x = ((LON + 180) / 360) * WORLD + dx;
	const y =
		((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD +
		dy;
	const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / WORLD)));
	return [(x / WORLD) * 360 - 180, (lat * 180) / Math.PI];
}

/** Checks a rectangle of plan colour, 3 px inside and outside each edge (screen pixels). */
async function expectPlanAt(
	page: Page,
	{
		left,
		top,
		right,
		bottom,
	}: { left: number; top: number; right: number; bottom: number },
) {
	const plan = blend(RED, 0.5, BACKGROUND);
	const midX = (left + right) / 2;
	const midY = (top + bottom) / 2;
	await expectPixel(page, left + 3, midY, plan);
	await expectPixel(page, right - 3, midY, plan);
	await expectPixel(page, midX, top + 3, plan);
	await expectPixel(page, midX, bottom - 3, plan);
	await expectPixel(page, left - 3, midY, BACKGROUND);
	await expectPixel(page, right + 3, midY, BACKGROUND);
	await expectPixel(page, midX, top - 3, BACKGROUND);
	await expectPixel(page, midX, bottom + 3, BACKGROUND);
}

/** Two untagged OSM nodes (not drawn), to snap control points to. */
function nodesAt(...offsets: [number, number][]) {
	return offsets.map(([dx, dy], i) => {
		const [lon, lat] = lngLatAt(dx, dy);
		return { type: "node", id: 900 + i, lon, lat, version: 1 };
	});
}

test("aligns a plan with control points snapped to OSM nodes", async ({
	page,
}) => {
	// Nodes A and B, 360 × 260 screen px apart: plan pixels (20, 20) and (380, 280) go there.
	const A: [number, number] = [-180, -130];
	const B: [number, number] = [180, 130];
	await serveOsm(page, nodesAt(A, B));
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();
	const { cx, cy, mx, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	// Plan pixel (20, 20), where the plan was imported; then 7 px (5, −5) off node A. Both clicks
	// miss their node the same way, so without snapping the whole plan would shift.
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(mx + A[0] + 5, cy + A[1] - 5);
	// One point moves the plan: pixel (380, 280) is now 360 × 260 plan pixels from A.
	await page.mouse.click(mx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(mx + B[0] + 5, cy + B[1] - 5);

	await expect(
		page.getByRole("list", { name: "Control points" }).getByRole("listitem"),
	).toHaveCount(2);
	// Snapped exactly: one screen pixel per plan pixel, pixel (20, 20) on A.
	await expectPlanAt(page, {
		left: mx + A[0] - 20,
		top: cy + A[1] - 20,
		right: mx + A[0] + 380,
		bottom: cy + A[1] + 280,
	});
});

test("shows how far each control point is from where the plan puts it", async ({
	page,
}) => {
	const A: [number, number] = [-180, -130];
	const B: [number, number] = [180, 130];
	await serveOsm(page, nodesAt(A, B));
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();
	const { cx, cy, mx, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(mx + A[0], cy + A[1]);
	await page.mouse.click(mx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(mx + B[0], cy + B[1]);
	// Plan pixel (380, 20), now on screen at A + (360, 0), measured 20 px (~2 m) too far south.
	await page.mouse.click(mx + A[0] + 360, cy + A[1]);
	await page.mouse.click(mx + A[0] + 360, cy + A[1] + 20);

	const points = page
		.getByRole("list", { name: "Control points" })
		.getByRole("listitem");
	await expect(points).toHaveCount(3);
	const rms = await page.getByText(/^RMS error/).textContent();
	const metres = Number(rms?.match(/([\d.]+) m/)?.[1]);
	// Least squares spreads the 2 m error over the three points.
	expect(metres).toBeGreaterThan(0.3);
	expect(metres).toBeLessThan(2);
});

test("scales a plan to a measured distance", async ({ page }) => {
	await importPlan(page, "plan.png");
	const { cx, cy, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Measure" }).click();
	// Plan pixels (10, 150) and (390, 150): 380 px apart, said to be 38 m.
	const x1 = cx + (10 - 200) * scale;
	await page.mouse.click(x1, cy);
	await page.mouse.click(cx + (390 - 200) * scale, cy);
	await page.getByLabel("Real distance (m)").fill("38");
	await page.getByRole("button", { name: "Scale" }).click();

	// The plan is now 40 × 30 m. At zoom 19 a screen pixel is 2πR·cos(lat) / 512 / 2^19 m.
	const metresPerPixel =
		(2 * Math.PI * 6378137 * Math.cos((LAT * Math.PI) / 180)) / WORLD;
	const s = 40 / 400 / metresPerPixel;
	// Scaled about the first measured point, which stays put.
	await expectPlanAt(page, {
		left: x1 - 10 * s,
		top: cy - 150 * s,
		right: x1 + 390 * s,
		bottom: cy + 150 * s,
	});
});

test("keeps plans, where they were placed, after a reload", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const { cx, cy, scale } = await initialLayout(page, 300);
	await page.getByRole("radio", { name: "Measure" }).click();
	const x1 = cx + (10 - 200) * scale;
	await page.mouse.click(x1, cy);
	await page.mouse.click(cx + (390 - 200) * scale, cy);
	await page.getByLabel("Real distance (m)").fill("38");
	await page.getByRole("button", { name: "Scale" }).click();
	const metresPerPixel =
		(2 * Math.PI * 6378137 * Math.cos((LAT * Math.PI) / 180)) / WORLD;
	const s = 40 / 400 / metresPerPixel;
	const scaled = {
		left: x1 - 10 * s,
		top: cy - 150 * s,
		right: x1 + 390 * s,
		bottom: cy + 150 * s,
	};
	await expectPlanAt(page, scaled);

	await page.reload();

	await expectPlanAt(page, scaled);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(
		page.getByRole("list", { name: "Floor plans" }).getByRole("listitem"),
	).toContainText(["plan 400 × 300 px"]);
});

test("shows a plan only on its level", async ({ page }) => {
	await importPlan(page, "plan.png");
	const { cx, cy } = await initialLayout(page, 300);
	const centre = { x: cx, y: cy };
	const plan = blend(RED, 0.5, BACKGROUND);
	// Imported on the level shown, 0.
	await expect(
		page.getByRole("textbox", { name: "Level", exact: true }),
	).toHaveValue("0");
	await expectPixel(page, centre.x, centre.y, plan);

	await page.getByRole("textbox", { name: "Level", exact: true }).fill("1");
	await page
		.getByRole("textbox", { name: "Level", exact: true })
		.press("Enter");
	await expectPixel(page, centre.x, centre.y, BACKGROUND);

	await page.getByRole("button", { name: "Level up" }).click();
	await expect(page.getByTestId("level")).toHaveText("1");
	await expectPixel(page, centre.x, centre.y, plan);
});

/** Drags with the mouse from one screen point to another, in steps like a hand would. */
async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

/** Where the 400 × 300 px plan is once imported: centred, 60% of the map tall. */
async function importedPlanBox(page: Page) {
	const { cx, cy, scale } = await initialLayout(page, 300);
	const w = 400 * scale;
	const h = 300 * scale;
	return {
		cx,
		cy,
		w,
		h,
		left: cx - w / 2,
		top: cy - h / 2,
		right: cx + w / 2,
		bottom: cy + h / 2,
	};
}

test("moves a plan by dragging it", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await expectPlanAt(page, plan);

	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 60 },
	);

	await expectPlanAt(page, {
		left: plan.left + 100,
		top: plan.top + 60,
		right: plan.right + 100,
		bottom: plan.bottom + 60,
	});
});

test("turns and resizes a plan from a corner, around the opposite one", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// The top-right corner a quarter of the diagonal further out: 1.25 times larger, the
	// bottom-left corner staying put.
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + plan.w / 4, y: plan.top - plan.h / 4 },
	);

	await expectPlanAt(page, {
		left: plan.left,
		top: plan.bottom - plan.h * 1.25,
		right: plan.left + plan.w * 1.25,
		bottom: plan.bottom,
	});
});

test("only resizes a plan when a corner is dragged off its diagonal", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// 100 px to the right of the top-right corner: along the diagonal from the bottom left,
	// (w + 100, −h) reaches k = 1 + 100·w / (w² + h²) of it. No turning.
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + 100, y: plan.top },
	);

	const k = 1 + (100 * plan.w) / (plan.w ** 2 + plan.h ** 2);
	await expectPlanAt(page, {
		left: plan.left,
		top: plan.bottom - plan.h * k,
		right: plan.left + plan.w * k,
		bottom: plan.bottom,
	});
});

test("turns a plan with the handle above it", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// The handle sits above the top edge's middle, 8% of the plan's height out. Dragged to
	// the right of the centre, the plan turns a quarter clockwise around its centre.
	await drag(
		page,
		{ x: plan.cx, y: plan.top - 0.08 * plan.h },
		{ x: plan.cx + 250, y: plan.cy },
	);

	await expectPlanAt(page, {
		left: plan.cx - plan.h / 2,
		top: plan.cy - plan.w / 2,
		right: plan.cx + plan.h / 2,
		bottom: plan.cy + plan.w / 2,
	});
});

test("stretches a plan from a corner with Shift", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	await page.keyboard.down("Shift");
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + 80, y: plan.top },
	);
	await page.keyboard.up("Shift");

	await expectPlanAt(page, { ...plan, right: plan.right + 80 });
});

test("keeps a dragged plan where it was left after a reload", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 70, y: plan.cy + 40 },
	);
	// (Moved right: the floor plans panel covers the left of the map.)
	const moved = {
		left: plan.left + 70,
		top: plan.top + 40,
		right: plan.right + 70,
		bottom: plan.bottom + 40,
	};
	await expectPlanAt(page, moved);

	await page.reload();

	await expectPlanAt(page, moved);
});

/** Colour of the alignment marks. */
const TOOL: [number, number, number] = [0xd6, 0x24, 0x9f];

/**
 * How many pixels of the 2 px tall, `width` px long strip starting at (x, y) are in the marks'
 * colour: enough to tell a dashed line (some) from a solid one (all) and from none.
 */
async function toolPixels(page: Page, x: number, y: number, width: number) {
	const clip = { x: Math.round(x), y: Math.round(y) - 1, width, height: 2 };
	const png = await page.screenshot({ clip });
	const pixels = await page.evaluate(
		async ({ base64, w }) => {
			const blob = await (
				await fetch(`data:image/png;base64,${base64}`)
			).blob();
			const canvas = new OffscreenCanvas(w, 2);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No 2D context");
			context.drawImage(await createImageBitmap(blob), 0, 0);
			return [...context.getImageData(0, 0, w, 2).data];
		},
		{ base64: png.toString("base64"), w: width },
	);
	let count = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const rgb = pixels.slice(i, i + 3);
		if (rgb.every((c, j) => Math.abs(c - (TOOL[j] ?? 0)) <= 40)) count++;
	}
	return count;
}

test("shows a crosshair over the map while an align tool is on", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	const canvas = page.locator("canvas.maplibregl-canvas");
	// Over the plan, without a tool, the plan can be dragged.
	await page.mouse.move(plan.cx, plan.cy);
	await expect(canvas).toHaveCSS("cursor", "move");

	for (const name of ["Control points", "Measure", "Rotate"]) {
		await page.getByRole("radio", { name }).click();
		await page.mouse.move(plan.cx + 10, plan.cy);
		await expect(canvas).toHaveCSS("cursor", "crosshair");
		await page.mouse.move(plan.right + 40, plan.cy);
		await expect(canvas).toHaveCSS("cursor", "crosshair");
	}

	await page.getByRole("radio", { name: "Rotate" }).click();
	await expect(canvas).not.toHaveCSS("cursor", "crosshair");
});

test("draws the measure line to the pointer, then between the two spots", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page.getByRole("radio", { name: "Measure" }).click();
	const x1 = Math.round(plan.left + 20);
	const y = Math.round(plan.cy);
	await page.mouse.click(x1, y);

	// A dashed line follows the pointer: some of the strip along it is in the marks' colour.
	await page.mouse.move(x1 + 200, y, { steps: 4 });
	await expect.poll(() => toolPixels(page, x1 + 60, y, 24)).toBeGreaterThan(4);
	await expect.poll(() => toolPixels(page, x1 + 60, y, 24)).toBeLessThan(40);
	// Pointer moved down: the line turns away from the strip.
	await page.mouse.move(x1 + 200, y + 120, { steps: 4 });
	await expect.poll(() => toolPixels(page, x1 + 120, y, 24)).toBe(0);

	// The second spot: a solid line joins the two, and stays when the pointer leaves.
	await page.mouse.click(x1 + 200, y);
	await page.mouse.move(plan.cx, plan.bottom - 10, { steps: 4 });
	await expect.poll(() => toolPixels(page, x1 + 60, y, 24)).toBe(48);
});

test("clears the control points, leaving the plan where they put it", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page.getByRole("radio", { name: "Control points" }).click();
	const clear = page.getByRole("button", { name: "Clear" });
	await expect(clear).toBeDisabled();
	// The plan's centre, then 60 px to the right: one point moves the whole plan.
	await page.mouse.click(plan.cx, plan.cy);
	await expect(clear).toBeEnabled();
	await page.mouse.click(plan.cx + 60, plan.cy);
	const points = page
		.getByRole("list", { name: "Control points" })
		.getByRole("listitem");
	await expect(points).toHaveCount(1);
	const moved = {
		left: plan.left + 60,
		top: plan.top,
		right: plan.right + 60,
		bottom: plan.bottom,
	};
	await expectPlanAt(page, moved);

	await clear.click();

	await expect(points).toHaveCount(0);
	await expect(clear).toBeDisabled();
	await expectPlanAt(page, moved);
	await page.reload();
	await expectPlanAt(page, moved);
});
