/**
 * Large floor plans are split into tiles: GPUs cap texture sizes (often 4096 px, less on some
 * phones), and smaller textures upload faster. Each tile becomes its own MapLibre image source,
 * placed through the plan's transform so that neighbours meet exactly.
 */
import { type LngLat, project, type Transform } from "./georef.ts";

/** Largest tile side, in pixels: safe on every GPU MapLibre runs on. */
export const MAX_TILE_SIZE = 2048;

export interface Tile {
	/** Top-left pixel of the tile in the plan image. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Tiles covering a `width` × `height` image, row by row from the top left. */
export function tiles(
	width: number,
	height: number,
	maxSize = MAX_TILE_SIZE,
): Tile[] {
	const result: Tile[] = [];
	for (let y = 0; y < height; y += maxSize) {
		for (let x = 0; x < width; x += maxSize) {
			result.push({
				x,
				y,
				width: Math.min(maxSize, width - x),
				height: Math.min(maxSize, height - y),
			});
		}
	}
	return result;
}

/** Map positions of a tile's corners, clockwise from the top left. */
export function tileCorners(
	transform: Transform,
	{ x, y, width, height }: Tile,
): [LngLat, LngLat, LngLat, LngLat] {
	return [
		project(transform, [x, y]),
		project(transform, [x + width, y]),
		project(transform, [x + width, y + height]),
		project(transform, [x, y + height]),
	];
}
