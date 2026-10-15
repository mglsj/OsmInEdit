import {
	test as base,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

/** A basemap with no network sources, so tests never depend on a tile server. */
export const blankStyle = {
	version: 8,
	// Glyph requests are blocked below; MapLibre then falls back to local fonts.
	glyphs: "https://fonts.test/{fontstack}/{range}.pbf",
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
			(route) => {
				const url = route.request().url();
				if (url.includes("/styles/"))
					return route.fulfill({ json: blankStyle });
				if (url.includes("/api/0.6/map.json")) {
					return route.fulfill({ json: { version: "0.6", elements: [] } });
				}
				return route.abort();
			},
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

/** RGB colour of `color` drawn with `opacity` over `background`. */
export function blend(
	color: [number, number, number],
	opacity: number,
	background: [number, number, number],
): [number, number, number] {
	return color.map((c, i) =>
		Math.round(c * opacity + (background[i] ?? 0) * (1 - opacity)),
	) as [number, number, number];
}

/** Background colour of `blankStyle`. */
export const BACKGROUND: [number, number, number] = [0xe8, 0xee, 0xf4];

/** Waits until the pixel's colour is within `tolerance` of `expected` on each channel. */
export async function expectPixel(
	page: Page,
	x: number,
	y: number,
	expected: [number, number, number],
	tolerance = 4,
) {
	await expect
		.poll(
			async () => {
				const actual = await pixelAt(page, x, y);
				return actual.every(
					(c, i) => Math.abs(c - (expected[i] ?? 0)) <= tolerance,
				)
					? "match"
					: actual.join(",");
			},
			{ timeout: 10_000 },
		)
		.toBe("match");
}

/** Centre of the map on screen. */
export async function mapCenter(page: Page): Promise<{ x: number; y: number }> {
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("The map is not visible");
	return {
		x: Math.round(box.x + box.width / 2),
		y: Math.round(box.y + box.height / 2),
	};
}

/** Default place of the OSM extracts below. */
export const LAT = 48.13;
export const LON = -1.69;

export type Element = Record<string, unknown>;

/** A square room of `r` degrees around (lon, lat), as OSM JSON elements with ids from `id`. */
export function room(
	id: number,
	lon: number,
	lat: number,
	level: string,
	r = 0.0002,
): Element[] {
	const corners = [
		[lon - r, lat - r],
		[lon + r, lat - r],
		[lon + r, lat + r],
		[lon - r, lat + r],
	];
	return [
		...corners.map(([x, y], i) => ({
			type: "node",
			id: id + i + 1,
			lon: x,
			lat: y,
			version: 1,
		})),
		{
			type: "way",
			id,
			version: 1,
			nodes: [id + 1, id + 2, id + 3, id + 4, id + 1],
			tags: { indoor: "room", level },
		},
	];
}

/** Serves `elements` for every downloaded area and counts the downloads. */
export async function serveOsm(page: Page, elements: Element[]) {
	const requests: string[] = [];
	await page.route("**/api/0.6/map.json*", (route) => {
		requests.push(route.request().url());
		return route.fulfill({ json: { version: "0.6", elements } });
	});
	return requests;
}

/** Opens the map on a room and selects it. */
export async function selectRoom(
	page: Page,
	tags: Record<string, string> = {},
	elements: Element[] = room(100, LON, LAT, "0"),
) {
	const way = elements.at(-1) as { tags: Record<string, string> };
	way.tags = { ...way.tags, ...tags };
	await serveOsm(page, elements);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	const editor = page.getByRole("complementary", { name: "Feature editor" });
	// The room is drawn once its data has loaded.
	await expect(async () => {
		await page.mouse.click(x, y);
		await expect(editor).toBeVisible({ timeout: 500 });
	}).toPass({ timeout: 10_000 });
	return editor;
}

/** The raw tag editor of the feature editor, its section opened if it was closed. */
export async function tagsBox(page: Page): Promise<Locator> {
	const editor = page.getByRole("complementary", { name: "Feature editor" });
	const section = editor.getByRole("button", { name: /^Tags \(\d+\)$/ });
	if ((await section.getAttribute("aria-expanded")) === "false") {
		await section.click();
	}
	return editor.getByRole("textbox", { name: "Tags", exact: true });
}
