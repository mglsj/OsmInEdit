import type { Position } from "geojson";

/** Ray casting: whether a point is inside a closed ring. */
export function pointInRing(
	point: Position,
	ring: readonly Position[],
): boolean {
	const [x = 0, y = 0] = point;
	let inside = false;
	ring.forEach(([xi = 0, yi = 0], i) => {
		const [xj = 0, yj = 0] = ring.at(i - 1) ?? [];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	});
	return inside;
}

/** Whether a point is inside a polygon (outer ring, minus holes). */
export function pointInPolygon(
	point: Position,
	polygon: readonly Position[][],
): boolean {
	const [outer, ...holes] = polygon;
	return (
		outer !== undefined &&
		pointInRing(point, outer) &&
		!holes.some((hole) => pointInRing(point, hole))
	);
}
