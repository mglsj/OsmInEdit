import { asset } from "$app/paths";

/**
 * Instance configuration, read at runtime from `static/config.json` so a deployed build
 * can be reconfigured without rebuilding. It must never contain secrets: it is public.
 */
export interface EditorConfig {
	editor_name: string;
	/** OSM API base URL, e.g. https://api.openstreetmap.org or the dev server. */
	osm_api_url: string;
	/** OSM website handling the login; defaults to `osm_api_url` (true for the dev server). */
	oauth_url?: string;
	/** Public OAuth 2 client id registered on the OSM instance above (PKCE, no secret). */
	oauth_client_id: string;
	/** Editor Layer Index used to list background imagery; the osmlab one by default. */
	imagery_index_url?: string;
	/** Nominatim instance for place search; the OSMF one by default. */
	nominatim_url?: string;
	/** URL of a MapLibre style used as the default basemap. */
	basemap_style: string;
	/** Minimal zoom at which OSM data is downloaded. */
	data_min_zoom: number;
	map_initial_zoom: number;
	/** [lat, lon], used when the URL has no valid hash. */
	map_initial_latlng: [number, number];
}

export async function loadConfig(
	fetchFn: typeof fetch = fetch,
): Promise<EditorConfig> {
	const response = await fetchFn(asset("config.json"));
	if (!response.ok) {
		throw new Error(`Could not load config.json (HTTP ${response.status})`);
	}
	return (await response.json()) as EditorConfig;
}
