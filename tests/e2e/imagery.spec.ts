import { camera, expect, test } from "./fixtures.ts";

const INDEX = "https://osmlab.github.io/editor-layer-index/imagery.geojson";

const square = (x0: number, y0: number, x1: number, y1: number) => ({
	type: "Polygon",
	coordinates: [
		[
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
			[x0, y0],
		],
	],
});

test("lists the imagery covering the view and shows the chosen one", async ({
	page,
}) => {
	await page.route(INDEX, (route) =>
		route.fulfill({
			json: {
				type: "FeatureCollection",
				features: [
					{
						type: "Feature",
						geometry: null,
						properties: {
							id: "world",
							name: "World photo",
							type: "tms",
							url: "https://tiles.example.test/{zoom}/{x}/{y}.png",
						},
					},
					{
						type: "Feature",
						geometry: square(-5, 41, 10, 51),
						properties: {
							id: "france",
							name: "France photo",
							type: "tms",
							url: "https://fr.example.test/{zoom}/{x}/{y}.png",
							best: true,
						},
					},
					{
						type: "Feature",
						geometry: square(100, -40, 110, -30),
						properties: {
							id: "elsewhere",
							name: "Elsewhere photo",
							type: "tms",
							url: "https://far.example.test/{zoom}/{x}/{y}.png",
						},
					},
				],
			},
		}),
	);
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	await page.getByRole("button", { name: "Background" }).click();
	const list = page.getByRole("group", { name: "Background imagery" });
	await expect(list.getByRole("radio")).toHaveCount(3);
	await expect(list).toContainText("France photo");
	await expect(list).toContainText("World photo");
	await expect(list).not.toContainText("Elsewhere photo");
	await expect(list.getByRole("radio", { name: "Map" })).toBeChecked();

	// MapLibre zoom levels count 512 px tiles: 256 px imagery comes from the next zoom level.
	const tile = page.waitForRequest(/fr\.example\.test\/20\/\d+\/\d+\.png/);
	await list.getByRole("radio", { name: "France photo" }).check();
	await tile;
	await expect(list.getByRole("radio", { name: "France photo" })).toBeChecked();
});

test("reports an imagery list that can't be loaded", async ({ page }) => {
	await page.route(INDEX, (route) => route.fulfill({ status: 503 }));
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	await page.getByRole("button", { name: "Background" }).click();
	await expect(page.getByRole("alert")).toContainText("imagery list");
});

test("scrolls a long imagery list inside the window", async ({ page }) => {
	await page.route(INDEX, (route) =>
		route.fulfill({
			json: {
				type: "FeatureCollection",
				features: Array.from({ length: 60 }, (_, i) => ({
					type: "Feature",
					geometry: null,
					properties: {
						id: `photo-${i}`,
						name: `Photo ${i}`,
						type: "tms",
						url: `https://tiles${i}.example.test/{zoom}/{x}/{y}.png`,
					},
				})),
			},
		}),
	);
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	await page.getByRole("button", { name: "Background" }).click();
	const list = page.getByRole("group", { name: "Background imagery" });
	await expect(list.getByRole("radio")).toHaveCount(61);
	// About 9 entries fit in the list: the 13th, which would still be inside the window if
	// the list spilled out of its popover, is hidden until scrolled to.
	await expect(
		list.getByRole("radio", { name: "Photo 12" }),
	).not.toBeInViewport();
	const last = list.getByRole("radio", { name: "Photo 59" });
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport();
	await last.check();
	await expect(last).toBeChecked();
});
