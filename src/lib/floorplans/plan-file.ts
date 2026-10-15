/**
 * Floor plan files: IndoorID's own JSON export, and the `osminedit_floor_imagery.json` files
 * written by OsmInEdit 1.x. Images travel inside the file as data URLs.
 */
import {
	type ControlPoint,
	fitPlan,
	type LngLat,
	type Transform,
	type TransformKind,
} from "./georef.ts";

/** Where a plan sits: a fitted transform, or (1.x files) the map positions of its corners. */
export type PlanPlacement =
	| { readonly transform: Transform }
	| { readonly corners: readonly [LngLat, LngLat, LngLat, LngLat] };

export interface PlanFileEntry {
	readonly name: string;
	/** The image, as a data URL. */
	readonly image: string;
	/** Image size in pixels, when the file says (1.x files may not). */
	readonly width?: number;
	readonly height?: number;
	/** OSM level the plan shows, like `0` or `-1`; null when not assigned yet. */
	readonly level: string | null;
	readonly opacity: number;
	readonly visible: boolean;
	/** Colour of the plan's frame and marks, `#rrggbb`; files from before colours have none. */
	readonly color?: string;
	readonly placement: PlanPlacement;
	readonly controlPoints: readonly ControlPoint[];
}

export class PlanFileError extends Error {
	override name = "PlanFileError";
}

const FORMAT = "indoorid-floorplans";

export function exportPlans(plans: readonly PlanFileEntry[]): string {
	return JSON.stringify({ format: FORMAT, version: 1, plans }, null, 2);
}

/** Reads an IndoorID or OsmInEdit 1.x floor plan file. */
export function parsePlansFile(text: string): PlanFileEntry[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new PlanFileError("This file is not a floor plan file (not JSON).");
	}
	if (isRecord(data) && data.format === FORMAT && Array.isArray(data.plans)) {
		return data.plans.map(readPlan);
	}
	if (Array.isArray(data)) return data.map(readLegacyPlan);
	throw new PlanFileError(
		"This file is not an IndoorID or OsmInEdit floor plan file.",
	);
}

/** The transform of a plan whose image is `width` × `height` pixels. */
export function transformOf(
	entry: PlanFileEntry,
	width: number,
	height: number,
): Transform {
	const { placement } = entry;
	if ("transform" in placement) return placement.transform;
	const [tl, tr, br, bl] = placement.corners;
	// Four exact corners: a perspective, as 1.x drew its plans (CSS matrix3d).
	return fitPlan(
		[
			{ image: [0, 0], map: tl },
			{ image: [width, 0], map: tr },
			{ image: [width, height], map: br },
			{ image: [0, height], map: bl },
		],
		"projective",
	).transform;
}

const KINDS: readonly TransformKind[] = ["similarity", "affine", "projective"];

function readPlan(value: unknown): PlanFileEntry {
	if (!isRecord(value)) throw invalid();
	const { transform } = isRecord(value.placement) ? value.placement : {};
	if (
		!isRecord(transform) ||
		!KINDS.includes(transform.kind as TransformKind) ||
		!Array.isArray(transform.matrix) ||
		transform.matrix.length !== 9 ||
		!transform.matrix.every(Number.isFinite)
	) {
		throw invalid();
	}
	const width = value.width;
	const height = value.height;
	if (!isPositive(width) || !isPositive(height)) throw invalid();
	return {
		name: typeof value.name === "string" ? value.name : "Floor plan",
		image: imageOf(value.image),
		width,
		height,
		level: typeof value.level === "string" ? value.level : null,
		opacity: opacityOf(value.opacity, 0.5),
		visible: value.visible !== false,
		...colorOf(value.color),
		placement: { transform: transform as unknown as Transform },
		controlPoints: Array.isArray(value.controlPoints)
			? (value.controlPoints as ControlPoint[])
			: [],
	};
}

/** A 1.x entry: Leaflet corners (`[lat, lng]` or `{lat, lng}`), numeric level, 0–1 opacity. */
function readLegacyPlan(value: unknown): PlanFileEntry {
	if (!isRecord(value)) throw invalid();
	const tl = latLng(value.topleft);
	const tr = latLng(value.topright);
	const bl = latLng(value.bottomleft);
	// 1.x drew a missing bottom-right corner from its neighbours.
	const br = value.bottomright ? latLng(value.bottomright) : [tr[0], bl[1]];
	const level = typeof value.level === "number" ? value.level : Number.NaN;
	return {
		name: typeof value.label === "string" ? value.label : "Floor plan",
		image: imageOf(value.image),
		...(isPositive(value.origWidth) && isPositive(value.origHeight)
			? { width: value.origWidth, height: value.origHeight }
			: {}),
		level: Number.isFinite(level) ? String(level) : null,
		opacity: opacityOf(value.opacity, 1),
		visible: value.visible !== false,
		placement: { corners: [tl, tr, br as LngLat, bl] },
		controlPoints: [],
	};
}

function latLng(value: unknown): LngLat {
	if (Array.isArray(value) && value.length >= 2) {
		const [lat, lng] = value;
		if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
	}
	if (
		isRecord(value) &&
		Number.isFinite(value.lat) &&
		Number.isFinite(value.lng)
	) {
		return [value.lng as number, value.lat as number];
	}
	throw invalid();
}

function imageOf(value: unknown): string {
	if (typeof value === "string" && value.startsWith("data:image/"))
		return value;
	throw new PlanFileError("A floor plan in this file has no image.");
}

/** `{ color }` when the value is a `#rrggbb` colour, else nothing: it ends up in the map's style. */
function colorOf(value: unknown): { color?: string } {
	return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
		? { color: value.toLowerCase() }
		: {};
}

function opacityOf(value: unknown, fallback: number): number {
	return typeof value === "number" && value >= 0 && value <= 1
		? value
		: fallback;
}

function isPositive(value: unknown): value is number {
	return typeof value === "number" && value > 0 && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): PlanFileError {
	return new PlanFileError(
		"A floor plan in this file is damaged or incomplete.",
	);
}
