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
	test,
} from "./fixtures.ts";

const FILES = path.join(import.meta.dirname, "files");
const RED: [number, number, number] = [255, 0, 0];

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
