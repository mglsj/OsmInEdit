import { camera, expect, test } from "./fixtures.ts";

test("finds a place and moves the map to it", async ({ page }) => {
	const searches: URL[] = [];
	await page.route("https://nominatim.openstreetmap.org/search*", (route) => {
		searches.push(new URL(route.request().url()));
		return route.fulfill({
			json: [
				{
					display_name: "Gare de Rennes, Place de la Gare, Rennes, France",
					name: "Gare de Rennes",
					lat: "48.1035",
					lon: "-1.6721",
					boundingbox: ["48.1030", "48.1040", "-1.6730", "-1.6712"],
				},
			],
		});
	});
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	const search = page.getByRole("searchbox", { name: "Search a place" });
	await search.fill("Gare de Rennes");
	await search.press("Enter");
	await page
		.getByRole("list", { name: "Search results" })
		.getByRole("button", { name: /Gare de Rennes/ })
		.click();

	await expect
		.poll(async () => (await camera(page)).lat)
		.toBeCloseTo(48.1035, 3);
	expect((await camera(page)).lon).toBeCloseTo(-1.6721, 3);
	expect(searches).toHaveLength(1);
	expect(searches[0]?.searchParams.get("q")).toBe("Gare de Rennes");
	await expect(page.getByRole("list", { name: "Search results" })).toBeHidden();
});

test("says when nothing was found", async ({ page }) => {
	await page.route("https://nominatim.openstreetmap.org/search*", (route) =>
		route.fulfill({ json: [] }),
	);
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	const search = page.getByRole("searchbox", { name: "Search a place" });
	await search.fill("Nowhere at all");
	await search.press("Enter");
	await expect(page.getByRole("list", { name: "Search results" })).toHaveText(
		"No place found",
	);
});
