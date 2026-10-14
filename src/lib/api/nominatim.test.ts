import { describe, expect, it } from "vitest";
import { searchPlaces } from "./nominatim.ts";

function fakeFetch(respond: () => Response) {
	const urls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input));
		return respond();
	}) as typeof globalThis.fetch;
	return { fetch, urls };
}

const near = { west: -1.7, south: 48.1, east: -1.6, north: 48.2 };

describe("searchPlaces", () => {
	it("searches near the current view and returns places", async () => {
		const { fetch, urls } = fakeFetch(() =>
			Response.json([
				{
					display_name: "Gare de Rennes, Place de la Gare, Rennes, France",
					name: "Gare de Rennes",
					lat: "48.1035",
					lon: "-1.6721",
					boundingbox: ["48.1020", "48.1050", "-1.6750", "-1.6690"],
					category: "railway",
					type: "station",
				},
			]),
		);

		const places = await searchPlaces("gare de Rennes & co", {
			fetch,
			baseUrl: "https://nominatim.example.org/",
			near,
		});

		const url = new URL(urls[0] ?? "");
		expect(url.origin + url.pathname).toBe(
			"https://nominatim.example.org/search",
		);
		expect(url.searchParams.get("q")).toBe("gare de Rennes & co");
		expect(url.searchParams.get("format")).toBe("jsonv2");
		expect(url.searchParams.get("viewbox")).toBe("-1.7,48.2,-1.6,48.1");
		expect(places).toEqual([
			{
				name: "Gare de Rennes",
				description: "Gare de Rennes, Place de la Gare, Rennes, France",
				lat: 48.1035,
				lon: -1.6721,
				bbox: { south: 48.102, north: 48.105, west: -1.675, east: -1.669 },
			},
		]);
	});

	it("uses the full address when a place has no name", async () => {
		const { fetch } = fakeFetch(() =>
			Response.json([
				{
					display_name: "12, Rue de Paris, Rennes",
					name: "",
					lat: "48.11",
					lon: "-1.66",
				},
			]),
		);
		const [place] = await searchPlaces("12 rue de Paris", { fetch, near });
		expect(place).toMatchObject({ name: "12, Rue de Paris, Rennes" });
		expect(place).not.toHaveProperty("bbox");
	});

	it("doesn't search for a blank query", async () => {
		const { fetch, urls } = fakeFetch(() => Response.json([]));
		await expect(searchPlaces("   ", { fetch, near })).resolves.toEqual([]);
		expect(urls).toEqual([]);
	});

	it("reports a failed search", async () => {
		const { fetch } = fakeFetch(
			() => new Response("Too many requests", { status: 429 }),
		);
		await expect(searchPlaces("Rennes", { fetch, near })).rejects.toThrow(
			"429",
		);
	});
});
