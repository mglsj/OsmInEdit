import {
	test as base,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

/** A basemap with no network sources, so tests never depend on a tile server. */
export const blankStyle = {
	version: 8,
	sources: {},
	layers: [
		{
			id: "background",
			type: "background",
			paint: { "background-color": "#e8eef4" },
		},
	],
};

/** Serves the basemap style from a fixture and blocks every other external request. */
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route(
			(url) => url.hostname !== "localhost",
			(route) =>
				route.request().url().includes("/styles/")
					? route.fulfill({ json: blankStyle })
					: route.abort(),
		);
		await use(page);
	},
});

export { expect };

export function mapLocator(page: Page): Locator {
	return page.getByTestId("map");
}

/** Waits until the map has rendered and reported a camera, then returns it. */
export async function camera(page: Page) {
	const map = mapLocator(page);
	await expect(map).toHaveAttribute("data-center");
	const [lat, lon] = (await map.getAttribute("data-center"))!
		.split(",")
		.map(Number);
	const zoom = Number(await map.getAttribute("data-zoom"));
	return { lat: lat!, lon: lon!, zoom };
}

export function hash(page: Page): Promise<string> {
	return page.evaluate(() => location.hash);
}

/** Reads the RGB colour of one screen pixel, decoding the screenshot in the page itself. */
export async function pixelAt(
	page: Page,
	x: number,
	y: number,
): Promise<[number, number, number]> {
	const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
	return page.evaluate(async (base64) => {
		const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("No 2D context");
		context.drawImage(await createImageBitmap(blob), 0, 0);
		const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
		return [r, g, b] as [number, number, number];
	}, png.toString("base64"));
}
