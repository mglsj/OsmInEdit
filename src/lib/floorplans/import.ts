/**
 * Turns floor plan files into images the map can draw: raster files (PNG, JPEG, WebP), SVG
 * drawings and PDF pages. Every plan ends up as an ImageBitmap cut into tiles, plus a PNG or the
 * original file to store and export.
 */
import { type Tile, tiles } from "./tiling.ts";

/** Longest side kept for a plan, in pixels; larger plans are scaled down on import. */
export const MAX_IMAGE_SIZE = 8192;
/** Longest side SVG drawings are rendered at: they have no resolution of their own. */
const SVG_SIZE = 4096;

export interface PlanImage {
	readonly width: number;
	readonly height: number;
	/** The image to store and export: the original raster file, or a PNG rendering. */
	readonly blob: Blob;
	/** The image cut into GPU-sized tiles. */
	readonly tiles: readonly { tile: Tile; bitmap: ImageBitmap }[];
}

export type PlanFileKind = "raster" | "svg" | "pdf" | "plans";

/** Accepted by the import file picker. */
export const ACCEPTED_FILES =
	"image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.json";

export function kindOf(file: File): PlanFileKind | null {
	const name = file.name.toLowerCase();
	if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
	if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
	if (file.type.startsWith("image/")) return "raster";
	if (file.type === "application/json" || name.endsWith(".json")) {
		return "plans";
	}
	return null;
}

/** File name without its extension, as the plan's name. */
export function planName(file: File): string {
	return file.name.replace(/\.[^.]+$/, "") || "Floor plan";
}

/** Decodes a PNG, JPEG or WebP image. */
export async function importRaster(file: Blob): Promise<PlanImage> {
	const full = await createImageBitmap(file).catch(() => {
		throw new Error("This image could not be read.");
	});
	const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(full.width, full.height));
	if (scale === 1) return fromBitmap(full, file);
	const canvas = drawScaled(full, scale);
	full.close();
	return fromCanvas(canvas);
}

/**
 * Renders an SVG drawing through an `<img>`: images never run the scripts or load the
 * resources an SVG may contain.
 */
export async function importSvg(file: Blob): Promise<PlanImage> {
	const url = URL.createObjectURL(
		file.type === "image/svg+xml"
			? file
			: new Blob([file], { type: "image/svg+xml" }),
	);
	try {
		const image = new Image();
		image.src = url;
		await image.decode().catch(() => {
			throw new Error("This SVG drawing could not be read.");
		});
		const width = image.naturalWidth || SVG_SIZE;
		const height = image.naturalHeight || SVG_SIZE;
		const scale = SVG_SIZE / Math.max(width, height);
		return fromCanvas(drawScaled(image, scale, width, height));
	} finally {
		URL.revokeObjectURL(url);
	}
}

export interface PdfDocument {
	readonly pageCount: number;
	/** Page size in inches. */
	pageSize(page: number): Promise<{ width: number; height: number }>;
	/** A small PNG of the page, as an object URL (revoked by `close`). */
	thumbnail(page: number): Promise<string>;
	/** Renders a page (from 1) at `dpi` dots per inch. */
	render(page: number, dpi: number): Promise<PlanImage>;
	close(): void;
}

/** Opens a PDF; pdf.js is only downloaded when a PDF is imported. */
export async function openPdf(file: Blob): Promise<PdfDocument> {
	const [pdfjs, { default: workerUrl }] = await Promise.all([
		// The legacy build polyfills recent JavaScript (Map.getOrInsertComputed…) that pdf.js
		// 6 uses and many browsers still lack.
		import("pdfjs-dist/legacy/build/pdf.mjs"),
		import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	const task = pdfjs.getDocument({
		data: new Uint8Array(await file.arrayBuffer()),
	});
	const pdf = await task.promise.catch(() => {
		throw new Error("This PDF could not be read.");
	});
	const urls: string[] = [];

	async function draw(page: number, scale: number): Promise<HTMLCanvasElement> {
		const pdfPage = await pdf.getPage(page);
		const viewport = pdfPage.getViewport({ scale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		await pdfPage.render({ canvas, viewport, background: "white" }).promise;
		return canvas;
	}

	return {
		pageCount: pdf.numPages,
		async pageSize(page) {
			const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });
			// PDF units are points, 72 per inch.
			return { width: viewport.width / 72, height: viewport.height / 72 };
		},
		async thumbnail(page) {
			const { width, height } = (await pdf.getPage(page)).getViewport({
				scale: 1,
			});
			const canvas = await draw(page, 160 / Math.max(width, height));
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve),
			);
			const url = blob ? URL.createObjectURL(blob) : "";
			urls.push(url);
			return url;
		},
		async render(page, dpi) {
			const { width, height } = (await pdf.getPage(page)).getViewport({
				scale: 1,
			});
			const scale = Math.min(
				dpi / 72,
				MAX_IMAGE_SIZE / Math.max(width, height),
			);
			return fromCanvas(await draw(page, scale));
		},
		close() {
			for (const url of urls) URL.revokeObjectURL(url);
			void task.destroy();
		},
	};
}

/** Draws an image scaled by `scale` onto a new canvas. */
function drawScaled(
	image: CanvasImageSource,
	scale: number,
	width = (image as ImageBitmap).width,
	height = (image as ImageBitmap).height,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas");
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	return canvas;
}

async function fromCanvas(canvas: HTMLCanvasElement): Promise<PlanImage> {
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (!blob) throw new Error("The plan could not be encoded.");
	return fromBitmap(await createImageBitmap(canvas), blob);
}

/** Cuts a decoded image into tiles. */
export async function fromBitmap(
	bitmap: ImageBitmap,
	blob: Blob,
): Promise<PlanImage> {
	const { width, height } = bitmap;
	const parts = tiles(width, height);
	const result =
		parts.length === 1
			? [{ tile: parts[0] as Tile, bitmap }]
			: await Promise.all(
					parts.map(async (tile) => ({
						tile,
						bitmap: await createImageBitmap(
							bitmap,
							tile.x,
							tile.y,
							tile.width,
							tile.height,
						),
					})),
				);
	if (parts.length > 1) bitmap.close();
	return { width, height, blob, tiles: result };
}
