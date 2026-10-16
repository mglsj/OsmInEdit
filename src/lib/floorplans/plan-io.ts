/**
 * Floor plans in and out of files: a picked file opened as a plan, a PDF to pick pages from,
 * or a plan file's plans; and every plan written to a plan file. Files are decoded through
 * `PlanDecoders`, so this runs in tests without a browser.
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import { type PlanContent, type PlanSize, rasterContent } from "./content.ts";
import type { ControlPoint, Transform, TransformKind } from "./georef.ts";
import {
	kindOf,
	type PdfDocument,
	type PlanDecoders,
	planName,
} from "./import.ts";
import {
	exportPlans,
	type PlanFileBuildings,
	type PlanFileEntry,
	parsePlanFile,
	transformOf,
} from "./plan-file.ts";

/** A plan read from a plan file, placed as saved, with its content. */
export interface ImportedPlan {
	readonly name: string;
	readonly size: PlanSize;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	readonly fitKind: TransformKind;
	readonly opacity: number;
	readonly level: string | null;
	readonly visible: boolean;
	/** Files from before colours have none. */
	readonly color?: string;
	readonly content: PlanContent;
}

/** A plan file's plans, bottom first, and where it had the building outlines. */
export interface ImportedPlans {
	readonly plans: readonly ImportedPlan[];
	readonly buildings?: PlanFileBuildings;
}

export type OpenedFile =
	| {
			readonly kind: "plan";
			readonly name: string;
			readonly content: PlanContent;
	  }
	| {
			readonly kind: "pdf";
			readonly name: string;
			readonly document: PdfDocument;
	  }
	| { readonly kind: "plans"; readonly plans: ImportedPlans };

/** Opens a file picked for import. */
export async function openPlanFile(
	file: File,
	decoders: PlanDecoders,
): Promise<OpenedFile> {
	const name = planName(file);
	switch (kindOf(file)) {
		case "raster":
			return { kind: "plan", name, content: await decoders.raster(file) };
		case "svg":
			return { kind: "plan", name, content: await decoders.svg(file) };
		case "pdf":
			return { kind: "pdf", name, document: await decoders.pdf(file) };
		case "plans":
			return {
				kind: "plans",
				plans: await readPlanFile(await file.text(), decoders),
			};
		default:
			throw new MessageError(msg("plan_import_unsupported"));
	}
}

/** A PDF page's plan name: the file's, with the page number when it has several. */
export function pageName(
	name: string,
	page: number,
	pageCount: number,
): string {
	return pageCount > 1 ? `${name}, page ${page}` : name;
}

/** Reads the plans of an IndoorID or OsmInEdit 1.x plan file, their images decoded. */
export async function readPlanFile(
	text: string,
	decoders: PlanDecoders,
): Promise<ImportedPlans> {
	const { plans, buildings } = parsePlanFile(text);
	const imported: ImportedPlan[] = [];
	for (const entry of plans) imported.push(await readPlan(entry, decoders));
	return { plans: imported, ...(buildings ? { buildings } : {}) };
}

async function readPlan(
	entry: PlanFileEntry,
	decoders: PlanDecoders,
): Promise<ImportedPlan> {
	const blob = await (await fetch(entry.image)).blob();
	const decoded =
		blob.type === "image/svg+xml"
			? await decoders.svg(blob)
			: await decoders.raster(blob);
	// Measured as saved: files from before plan units give the image's pixels.
	const size =
		entry.width && entry.height
			? { width: entry.width, height: entry.height }
			: decoded.size;
	return {
		name: entry.name,
		size,
		transform: transformOf(entry, size.width, size.height),
		controlPoints: entry.controlPoints,
		fitKind:
			"transform" in entry.placement
				? entry.placement.transform.kind
				: "projective",
		opacity: entry.opacity,
		level: entry.level,
		visible: entry.visible,
		...(entry.color ? { color: entry.color } : {}),
		content: decoded.raster
			? rasterContent(decoded.raster.image, size)
			: decoded,
	};
}

/** What a plan file keeps of a plan. */
export interface ExportedPlan {
	readonly id: string;
	readonly name: string;
	readonly size: PlanSize;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	readonly opacity: number;
	readonly level: string | null;
	readonly visible: boolean;
	readonly color: string;
}

/**
 * An IndoorID plan file of `plans` (bottom first) with their files, from `originalOf`; a plan
 * without one (its saving failed) is left out.
 */
export async function writePlanFile(
	plans: readonly ExportedPlan[],
	buildings: PlanFileBuildings,
	originalOf: (id: string) => Promise<Blob | undefined>,
): Promise<string> {
	const files = await Promise.all(plans.map((plan) => originalOf(plan.id)));
	const entries: PlanFileEntry[] = [];
	let below = 0;
	for (const [index, plan] of plans.entries()) {
		const file = files[index];
		if (!file) continue;
		if (index < buildings.below) below++;
		entries.push({
			name: plan.name,
			image: await dataUrl(file),
			// Plan units: the transform's.
			width: plan.size.width,
			height: plan.size.height,
			level: plan.level,
			opacity: plan.opacity,
			visible: plan.visible,
			color: plan.color,
			placement: { transform: plan.transform },
			controlPoints: plan.controlPoints,
		});
	}
	return exportPlans(entries, { below, visible: buildings.visible });
}

async function dataUrl(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	// In chunks: spreading megabytes of arguments overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
