/** Web Mercator tiles (the slippy-map grid), used to download OSM data in fixed chunks. */
import type { Bbox } from "#lib/api/osm-api.ts";

export interface Tile {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

const MAX_LATITUDE = 85.0511287798066;
/** Tolerance, in tiles, so that a tile's own bounds don't spill into its neighbours. */
const EPSILON = 1e-6;

function lonToX(lon: number, n: number): number {
	return ((lon + 180) / 360) * n;
}

function latToY(lat: number, n: number): number {
	const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
	const rad = (clamped * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
}

function yToLat(y: number, n: number): number {
	return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
}

/** Tiles of zoom `z` covering an area, row by row from the north-west. */
export function tilesCovering(bounds: Bbox, z: number): Tile[] {
	const n = 2 ** z;
	const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
	const x0 = clamp(Math.floor(lonToX(bounds.west, n) + EPSILON));
	const x1 = clamp(
		Math.max(x0, Math.ceil(lonToX(bounds.east, n) - EPSILON) - 1),
	);
	const y0 = clamp(Math.floor(latToY(bounds.north, n) + EPSILON));
	const y1 = clamp(
		Math.max(y0, Math.ceil(latToY(bounds.south, n) - EPSILON) - 1),
	);

	const tiles: Tile[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) tiles.push({ x, y, z });
	}
	return tiles;
}

export function tileBounds({ x, y, z }: Tile): Bbox {
	const n = 2 ** z;
	return {
		west: (x / n) * 360 - 180,
		east: ((x + 1) / n) * 360 - 180,
		north: yToLat(y, n),
		south: yToLat(y + 1, n),
	};
}
