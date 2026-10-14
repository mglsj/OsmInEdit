import type { Entity, Way } from "./entity.ts";
import type { Graph } from "./graph.ts";
import type { Tags } from "./tags.ts";

/** Keys whose closed ways are areas, unless `area=no`. */
const AREA_KEYS = new Set([
	"building",
	"building:part",
	"buildingpart",
	"room",
	"amenity",
	"shop",
	"office",
	"craft",
	"healthcare",
	"leisure",
	"tourism",
	"landuse",
	"area:highway",
]);

/** Whether a closed way is a surface (room, building) rather than a ring-shaped line (wall). */
export function isArea(tags: Tags): boolean {
	if (tags.area === "yes") return true;
	if (tags.area === "no") return false;
	if (tags.indoor) return tags.indoor !== "wall" && tags.indoor !== "door";
	if (tags.public_transport === "platform" || tags.railway === "platform")
		return true;
	if (tags.highway === "elevator") return true;
	return Object.keys(tags).some((key) => AREA_KEYS.has(key));
}

export function isClosed(way: Way): boolean {
	return way.nodes.length > 3 && way.nodes[0] === way.nodes.at(-1);
}

/** Geometry of an entity as presets see it: a node on a way is a vertex. */
export function entityGeometry(
	graph: Graph,
	entity: Entity,
): "point" | "vertex" | "line" | "area" | "relation" {
	switch (entity.type) {
		case "node":
			return graph.parentWays(entity.id).length > 0 ? "vertex" : "point";
		case "way":
			return isClosed(entity) && isArea(entity.tags) ? "area" : "line";
		case "relation":
			return entity.tags.type === "multipolygon" ? "area" : "relation";
	}
}
