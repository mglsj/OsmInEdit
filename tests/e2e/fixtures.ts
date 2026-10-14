import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** A basemap with no network sources, so tests never depend on a tile server. */
export const blankStyle = {
	version: 8,
	sources: {},
	layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8eef4' } }]
};

/** Serves the basemap style from a fixture and blocks every other external request. */
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.route(
			(url) => url.hostname !== 'localhost',
			(route) =>
				route.request().url().includes('/styles/')
					? route.fulfill({ json: blankStyle })
					: route.abort()
		);
		await use(page);
	}
});

export { expect };

export function mapLocator(page: Page): Locator {
	return page.getByTestId('map');
}

/** Waits until the map has rendered and reported a camera, then returns it. */
export async function camera(page: Page) {
	const map = mapLocator(page);
	await expect(map).toHaveAttribute('data-center');
	const [lat, lon] = (await map.getAttribute('data-center'))!.split(',').map(Number);
	const zoom = Number(await map.getAttribute('data-zoom'));
	return { lat: lat!, lon: lon!, zoom };
}

export function hash(page: Page): Promise<string> {
	return page.evaluate(() => location.hash);
}
