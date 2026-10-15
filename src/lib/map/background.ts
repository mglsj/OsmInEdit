/** The raster imagery shown under the indoor data, on top of the vector basemap. */
import { FLOORPLAN_PREFIX } from "./floorplan-layers.ts";
import type { ImageryEntry } from "./imagery.ts";
import type { Map as MapLibreMap } from "./maplibre.ts";

const SOURCE = "background-imagery";
const LAYER = "background-imagery";

/** Shows an imagery source, or only the basemap when `entry` is null. */
export function setBackground(
	map: MapLibreMap,
	entry: ImageryEntry | null,
): void {
	if (map.getLayer(LAYER)) map.removeLayer(LAYER);
	if (map.getSource(SOURCE)) map.removeSource(SOURCE);
	if (!entry) return;

	map.addSource(SOURCE, entry.source);
	// Below the indoor layers and floor plans, or else below the basemap labels.
	const layers = map.getStyle().layers;
	const before = map.getLayer("indoor-fill")
		? "indoor-fill"
		: (layers.find((l) => l.id.startsWith(FLOORPLAN_PREFIX))?.id ??
			layers.find((l) => l.type === "symbol")?.id);
	map.addLayer({ id: LAYER, type: "raster", source: SOURCE }, before);
}
