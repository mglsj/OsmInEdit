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
 * Checks that a plan of the given aspect ratio is drawn centred on the map, 60% of its height
 * tall, in `color` at opacity 0.5: pixels just inside its edges are blended, just outside not.
 */
async function expectPlanDrawn(
	page: Page,
	color: [number, number, number],
	aspect: number,
) {
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const height = box.height * 0.6;
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
	// A room inside a building 0.0008° (~600 px at zoom 19) wide.
	const building = room(200, LON, LAT, "0", 0.0004).map((e) =>
		e.type === "way" ? { ...e, tags: { building: "yes" } } : e,
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

	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByRole("group", { name: "Edit history" })).toBeHidden();
	// Rooms and fills are hidden; the building's outline is drawn ~298 px right of the centre.
	await expectPixel(page, centre.x, centre.y, BACKGROUND);
	await expectPixel(page, centre.x + 298, centre.y, BUILDING_OUTLINE, 40);
	// Clicking a room selects nothing.
	await page.mouse.click(centre.x, centre.y);
	await expect(editor).toBeHidden();

	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByRole("group", { name: "Edit history" })).toBeVisible();
	await expectPixel(page, centre.x, centre.y, editing);
});

test("draws a plan over the rooms already mapped", async ({ page }) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await importPlan(page, "plan.png");
	await page.getByRole("button", { name: "Done" }).click();
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	// Back to editing: the room's fill (80% opaque), then the plan at half opacity on top.
	const roomFill = blend([0xd6, 0xd1, 0xc7], 0.8, BACKGROUND);
	await expectPixel(
		page,
		box.x + box.width / 2,
		box.y + box.height / 2,
		blend(RED, 0.5, roomFill),
	);
});

test("keeps the fine lines of a large plan when it is shown small", async ({
	page,
}) => {
	// 4000 × 3000 px of alternating 1 px black and white columns, shown ~400 px tall: each
	// screen pixel covers several columns and should average them to mid-grey everywhere.
	await importPlan(page, "stripes.png");
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	const grey = blend([128, 128, 128], 0.5, BACKGROUND);
	const cy = box.y + box.height / 2;
	for (const dx of [-150, -97, -41, 0, 23, 71, 133]) {
		await expectPixel(page, box.x + box.width / 2 + dx, cy, grey, 12);
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

/** Map centre on screen, and how many screen pixels a plan pixel takes once imported. */
async function initialLayout(page: Page, planHeight: number) {
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	return {
		cx: box.x + box.width / 2,
		cy: box.y + box.height / 2,
		scale: (box.height * 0.6) / planHeight,
	};
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
	const { cx, cy, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	// Plan pixel (20, 20), where the plan was imported; then 7 px (5, −5) off node A. Both clicks
	// miss their node the same way, so without snapping the whole plan would shift.
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(cx + A[0] + 5, cy + A[1] - 5);
	// One point moves the plan: pixel (380, 280) is now 360 × 260 plan pixels from A.
	await page.mouse.click(cx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(cx + B[0] + 5, cy + B[1] - 5);

	await expect(
		page.getByRole("list", { name: "Control points" }).getByRole("listitem"),
	).toHaveCount(2);
	// Snapped exactly: one screen pixel per plan pixel, pixel (20, 20) on A.
	await expectPlanAt(page, {
		left: cx + A[0] - 20,
		top: cy + A[1] - 20,
		right: cx + A[0] + 380,
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
	const { cx, cy, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(cx + A[0], cy + A[1]);
	await page.mouse.click(cx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(cx + B[0], cy + B[1]);
	// Plan pixel (380, 20), now on screen at A + (360, 0), measured 20 px (~2 m) too far south.
	await page.mouse.click(cx + A[0] + 360, cy + A[1]);
	await page.mouse.click(cx + A[0] + 360, cy + A[1] + 20);

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
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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
