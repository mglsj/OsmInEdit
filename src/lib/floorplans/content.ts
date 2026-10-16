/**
 * What a floor plan shows, apart from where it is placed: its size in plan units and the
 * content drawn over that size. Plan units are the file's own: PDF points, SVG user units, a
 * photo's or scan's pixels. A plan's transform maps plan units, so rendering a PDF at another
 * DPI moves nothing. Content (bitmaps, later vector geometry) stays out of the reactive plan
 * list: it is large, and loaded only for the plans shown.
 */
import type { PlanImage } from "./import.ts";

/** A size in plan units. */
export interface PlanSize {
	readonly width: number;
	readonly height: number;
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
