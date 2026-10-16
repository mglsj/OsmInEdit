/**
 * How plan content is turned into stored blobs and back: tiles encoded for IndexedDB, tiles
 * decoded for the map, thumbnails for the list, and the whole images plans were saved as before
 * schema 3. An interface, so state is tested without a browser; R2.3 moves the work to a worker.
 */
import { decodeRaster, type PlanImage } from "./import.ts";

export interface PlanCodec {
	/** A tile as stored: a format this browser reads back, lossless. */
	encode(bitmap: ImageBitmap): Promise<Blob>;
	decode(blob: Blob): Promise<ImageBitmap>;
	/** A small picture of the plan for the list, at most `THUMBNAIL_SIZE` pixels. */
	thumbnail(image: PlanImage): Promise<Blob>;
	/** A whole image saved before schema 3, as a pyramid of tiles. */
	decodeImage(blob: Blob): Promise<PlanImage>;
}

export const THUMBNAIL_SIZE = 128;

/** The codec on this thread: lossless WebP where the canvas encodes it, else PNG. */
export const browserCodec: PlanCodec = {
	async encode(bitmap) {
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
		// Quality 1 asks for lossless WebP; a browser without it gives PNG.
		return canvas.convertToBlob({ type: "image/webp", quality: 1 });
	},
	decode: (blob) => createImageBitmap(blob),
	async thumbnail(image) {
		const smallest = image.levels.at(-1);
		const scale = THUMBNAIL_SIZE / Math.max(image.width, image.height);
		const canvas = new OffscreenCanvas(
			Math.max(1, Math.round(image.width * scale)),
			Math.max(1, Math.round(image.height * scale)),
		);
		const context = canvas.getContext("2d");
		for (const { tile, bitmap } of smallest?.tiles ?? []) {
			context?.drawImage(
				bitmap,
				tile.x * scale,
				tile.y * scale,
				tile.width * scale,
				tile.height * scale,
			);
		}
		return canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
	},
	decodeImage: decodeRaster,
};
