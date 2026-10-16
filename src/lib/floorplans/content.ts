/**
 * What a floor plan shows, apart from where it is placed: its size in plan units and the
 * content drawn over that size. Plan units are the file's own: PDF points, SVG user units, a
 * photo's or scan's pixels. A plan's transform maps plan units, so rendering a PDF at another
 * DPI moves nothing. Content (bitmaps, later vector geometry) stays out of the reactive plan
 * list: it is large, and loaded only for the plans shown.
 */
import type { Tile } from "./tiling.ts";

/** A size in plan units. */
export interface PlanSize {
	readonly width: number;
	readonly height: number;
}

/** A plan's pixels, cut into tiles at several scales. */
export interface PlanImage {
	readonly width: number;
	readonly height: number;
	/** The image to store and export: the original raster file, or a PNG rendering. */
	readonly blob: Blob;
	/**
	 * The image at full size, then halved again and again: the map draws the level matching the
	 * zoom. MapLibre doesn't mipmap image sources, so a large plan drawn small would otherwise
	 * lose its thin lines between the pixels it samples.
	 */
	readonly levels: readonly PlanLevel[];
	/**
	 * The tiles as stored, and a thumbnail: encoded in the plan worker while the plan is already
	 * shown (lossless JPEG XL takes about half a second a tile).
	 */
	readonly encoded: Promise<EncodedImage>;
}

export interface PlanLevel {
	/** Image pixels per pixel of this level: 1, 2, 4… */
	readonly scale: number;
	/** The level cut into GPU-sized tiles, placed in full-size image pixels. */
	readonly tiles: readonly {
		readonly tile: Tile;
		readonly bitmap: ImageBitmap;
	}[];
}

/** A plan image's tiles encoded for storage (lossless), level by level as in `levels`. */
export interface EncodedImage {
	readonly levels: readonly {
		readonly scale: number;
		readonly tiles: readonly { readonly tile: Tile; readonly blob: Blob }[];
	}[];
	/** A small picture of the plan for the list; plans stored without one have none. */
	readonly thumbnail?: Blob;
}

export interface RasterContent {
	/** Plan units per pixel of the full-size image (72/DPI for a PDF page, 1 for a photo). */
	readonly unit: number;
	readonly image: PlanImage;
}

export interface PlanContent {
	readonly size: PlanSize;
	readonly raster?: RasterContent;
}

/**
 * Content drawn from pixels over `size` plan units (the image's own pixels when not given: a
 * photo, a scan, or a plan saved before plan units).
 */
export function rasterContent(image: PlanImage, size?: PlanSize): PlanContent {
	const planSize = size ?? { width: image.width, height: image.height };
	return {
		size: planSize,
		raster: { unit: planSize.width / image.width, image },
	};
}

/** Frees a content's bitmaps (a plan removed or its content dropped). */
export function closeContent(content: PlanContent | undefined): void {
	for (const level of content?.raster?.image.levels ?? []) {
		for (const { bitmap } of level.tiles) bitmap.close();
	}
}
