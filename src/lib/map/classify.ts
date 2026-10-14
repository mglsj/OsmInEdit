/**
 * How the map draws each feature, decided once per feature in code rather than in long style
 * expressions. The rules follow the 1.x stylesheet (`public/style.mapcss`) and Simple Indoor
 * Tagging, plus older tags still found in the data (`room=*`, `buildingpart=*`).
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { Preset } from "#lib/presets/presets.ts";

export type FeatureKind =
	/** Walled indoor space: `indoor=room`. */
	| "room"
	/** Open indoor space: `indoor=area|corridor|level`, platforms. */
	| "space"
	/** Stairwell, elevator shaft, escalator area. */
	| "vertical"
	| "wall"
	| "column"
	| "building"
	/** Door or entrance (point, or line for a wide opening). */
	| "door"
	/** Opening without a door: `door=no`. */
	| "passage"
	/** Walkable line: corridors, footways, steps. */
	| "path"
	| "poi"
	| "line"
	| "area";

export type GeometryType = "Point" | "LineString" | "Polygon" | "MultiPolygon";

const SPACE_ROOMS = new Set([
	"corridor",
	"hall",
	"entry",
	"gallery",
	"collection",
	"entrance",
]);
const VERTICAL_ROOMS = new Set(["stairs", "escalator", "elevator"]);
const SPACE_HIGHWAYS = new Set(["pedestrian", "footway", "corridor"]);

export function classify(tags: Tags, geometry: GeometryType): FeatureKind {
	const surface = geometry === "Polygon" || geometry === "MultiPolygon";

	if (!surface && (tags.door !== undefined || tags.entrance !== undefined)) {
		return tags.door === "no" ? "passage" : "door";
	}
	if (surface && isVertical(tags)) return "vertical";
	if (tags.indoor === "wall") return "wall";
	if (
		tags.indoor === "column" ||
		tags.man_made === "pillar" ||
		tags["building:part"] === "column"
	) {
		return "column";
	}
	if (surface) {
		if (
			tags.indoor === "room" ||
			tags.buildingpart === "room" ||
			(tags.room !== undefined && !SPACE_ROOMS.has(tags.room))
		) {
			return "room";
		}
		if (isSpace(tags)) return "space";
		if (tags.building !== undefined || tags["building:part"] !== undefined) {
			return "building";
		}
		return "area";
	}
	if (geometry === "Point") return "poi";
	return tags.highway !== undefined ? "path" : "line";
}

function isVertical(tags: Tags): boolean {
	return (
		tags.stairs === "yes" ||
		tags.elevator === "yes" ||
		tags.highway === "elevator" ||
		tags.highway === "steps" ||
		tags.conveying !== undefined ||
		(tags.room !== undefined && VERTICAL_ROOMS.has(tags.room)) ||
		tags.buildingpart === "verticalpassage"
	);
}

function isSpace(tags: Tags): boolean {
	return (
		tags.indoor === "area" ||
		tags.indoor === "corridor" ||
		tags.indoor === "level" ||
		tags.buildingpart === "corridor" ||
		tags.buildingpart === "hall" ||
		(tags.room !== undefined && SPACE_ROOMS.has(tags.room)) ||
		(tags.highway !== undefined && SPACE_HIGHWAYS.has(tags.highway)) ||
		tags.public_transport === "platform" ||
		tags.railway === "platform" ||
		tags.shop === "mall"
	);
}

/** Whether a space is closed to the public, drawn darker. */
export function isRestricted(tags: Tags): boolean {
	return (
		tags.access === "private" ||
		tags.access === "no" ||
		tags.room === "technical"
	);
}

/** Room types whose icon has another name. */
const ROOM_ICON_ALIASES: Readonly<Record<string, string>> = {
	amphitheatre: "auditorium",
	reception: "administration",
	refectory: "restaurant",
	checkroom: "locker",
};

/** Keys whose value names an icon, `key_value`, in order of priority. */
const ICON_KEYS = [
	"amenity",
	"shop",
	"tourism",
	"emergency",
	"healthcare",
	"office",
	"leisure",
	"craft",
	"railway",
	"barrier",
	"man_made",
	"historic",
	"natural",
	"aeroway",
	"sport",
];

/**
 * Presets of the building's structure, which the map already shows by its shapes and colours:
 * an icon on every room or door would only clutter it.
 */
const STRUCTURE_PRESETS =
	/^(indoor(\/(room|area|corridor|level|wall|door))?$|(door|entrance|building|building_part|highway\/(corridor|footway|pedestrian_area))(\/|$))/;

/**
 * The icon of a feature, or null: its preset's icon (Maki or Temaki) when bundled, else the
 * first available 1.x icon.
 */
export function iconFor(
	tags: Tags,
	available: ReadonlySet<string>,
	preset?: Pick<Preset, "id" | "icon">,
): string | null {
	const candidates: string[] = [];
	if (preset?.icon && !STRUCTURE_PRESETS.test(preset.id)) {
		candidates.push(preset.icon);
	}
	if (tags.conveying !== undefined || tags.room === "escalator") {
		candidates.push("passage_escalator");
	}
	if (
		tags.elevator === "yes" ||
		tags.highway === "elevator" ||
		tags.room === "elevator"
	) {
		candidates.push("highway_elevator");
	}
	if (
		tags.stairs === "yes" ||
		tags.highway === "steps" ||
		tags.room === "stairs"
	) {
		candidates.push("highway_steps");
	}
	for (const key of ICON_KEYS) {
		if (tags[key] !== undefined) candidates.push(`${key}_${tags[key]}`);
	}
	if (tags.room !== undefined) {
		candidates.push(`room_${ROOM_ICON_ALIASES[tags.room] ?? tags.room}`);
	}
	return candidates.find((icon) => available.has(icon)) ?? null;
}

/** Text shown on the map: the name, or else the ref (e.g. a room number). */
export function labelFor(tags: Tags): string | null {
	return tags.name ?? tags.ref ?? null;
}
