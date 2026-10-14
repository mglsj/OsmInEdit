/**
 * Place search with Nominatim. Its usage policy forbids autocomplete: search only when the user
 * submits. See https://operations.osmfoundation.org/policies/nominatim/
 */
import type { Bbox } from "./osm-api.ts";

export const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org";

export interface Place {
	/** Short name, or the full address when the place has no name. */
	readonly name: string;
	/** Full address. */
	readonly description: string;
	readonly lat: number;
	readonly lon: number;
	readonly bbox?: Bbox;
}

export interface SearchOptions {
	/** Results near this area come first. */
	readonly near: Bbox;
	readonly baseUrl?: string;
	readonly fetch?: typeof fetch;
	readonly signal?: AbortSignal;
}

interface NominatimResult {
	display_name: string;
	name?: string;
	lat: string;
	lon: string;
	/** [south, north, west, east] */
	boundingbox?: [string, string, string, string];
}

export async function searchPlaces(
	query: string,
	{
		near,
		baseUrl = DEFAULT_NOMINATIM_URL,
		fetch = globalThis.fetch,
		signal,
	}: SearchOptions,
): Promise<Place[]> {
	const q = query.trim();
	if (!q) return [];

	const url = new URL(`${baseUrl.replace(/\/+$/, "")}/search`);
	url.searchParams.set("q", q);
	url.searchParams.set("format", "jsonv2");
	url.searchParams.set("limit", "8");
	url.searchParams.set(
		"viewbox",
		[near.west, near.north, near.east, near.south].join(","),
	);

	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new Error(`Search failed (HTTP ${response.status})`);
	}
	const results = (await response.json()) as NominatimResult[];
	return results.map(toPlace);
}

function toPlace(result: NominatimResult): Place {
	const place: Place = {
		name: result.name || result.display_name,
		description: result.display_name,
		lat: Number(result.lat),
		lon: Number(result.lon),
	};
	if (!result.boundingbox) return place;
	const [south, north, west, east] = result.boundingbox.map(Number) as [
		number,
		number,
		number,
		number,
	];
	return { ...place, bbox: { south, north, west, east } };
}
