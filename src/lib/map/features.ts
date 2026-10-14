/**
 * Turns the OSM graph into the GeoJSON drawn by the map. Each feature carries its tags plus:
 * - `@id`: the entity id (`w12`), used as the MapLibre feature id;
 * - `@lv`: the known levels it is on, as `;-1;0;0.5;`, or `*` when it has no level, so that a
 *   level switch is a filter change (`levelFilter`) rather than a data rebuild.
 */
import type {
	Feature,
	FeatureCollection,
	Geometry,
	MultiPolygon,
	Position,
} from "geojson";
import { featureLevels } from "#lib/levels/feature-levels.ts";
import { isOnLevel, type Levels } from "#lib/levels/levels.ts";
import type { Entity, NodeId, Relation, Way } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { hasInterestingTags, type Tags } from "#lib/osm/tags.ts";
import {
	classify,
	type GeometryType,
	iconFor,
	isRestricted,
	labelFor,
} from "./classify.ts";
import { pointInRing } from "./geometry.ts";
import type { FilterSpecification } from "./maplibre.ts";

export type FeatureProperties = Tags & { "@id": string; "@lv": string };
export type IndoorFeature = Feature<Geometry, FeatureProperties>;

export interface IndoorFeatures {
	readonly collection: FeatureCollection<Geometry, FeatureProperties>;
	/** Every level present in the data, sorted, including levels inside ranges. */
	readonly levels: number[];
}

export interface BuildOptions {
	/** Names of the icons the map can show (see `iconFor`). */
	readonly icons?: ReadonlySet<string>;
}

export function buildFeatures(
	graph: Graph,
	options: BuildOptions = {},
): IndoorFeatures {
	const icons = options.icons ?? new Set<string>();
	const drafts: {
		entity: Entity;
		geometry: Geometry;
		levels: Levels | null;
	}[] = [];
	for (const entity of graph.entities()) {
		const geometry = geometryOf(graph, entity);
		if (!geometry) continue;
		const parentTags = graph.parentRelations(entity.id).map((r) => r.tags);
		drafts.push({
			entity,
			geometry,
			levels: featureLevels(entity.tags, parentTags),
		});
	}

	const levels = knownLevels(drafts.map((d) => d.levels));
	const features = drafts.map(
		({ entity, geometry, levels: own }): IndoorFeature => ({
			type: "Feature",
			geometry,
			properties: {
				...entity.tags,
				...drawingProperties(entity.tags, geometry.type as GeometryType, icons),
				"@id": entity.id,
				"@lv": encodeLevels(own, levels),
			},
		}),
	);
	return { collection: { type: "FeatureCollection", features }, levels };
}

/** Properties the style uses: `@kind`, and when relevant `@icon`, `@label`, `@restricted`. */
function drawingProperties(
	tags: Tags,
	geometry: GeometryType,
	icons: ReadonlySet<string>,
): Record<string, string> {
	const props: Record<string, string> = { "@kind": classify(tags, geometry) };
	const icon = iconFor(tags, icons);
	if (icon) props["@icon"] = icon;
	const label = labelFor(tags);
	if (label) props["@label"] = label;
	if (isRestricted(tags)) props["@restricted"] = "yes";
	return props;
}

/** MapLibre filter keeping the features on `level`, and those without level information. */
export function levelFilter(level: number): FilterSpecification {
	return [
		"any",
		["==", ["get", "@lv"], "*"],
		["in", `;${String(level)};`, ["get", "@lv"]],
	];
}

function encodeLevels(levels: Levels | null, known: readonly number[]): string {
	if (!levels) return "*";
	return `;${known
		.filter((l) => isOnLevel(levels, l))
		.map(String)
		.join(";")};`;
}

/** Single levels and range ends, plus whole levels inside ranges. */
function knownLevels(all: readonly (Levels | null)[]): number[] {
	const set = new Set<number>();
	for (const levels of all) {
		for (const { min, max } of levels ?? []) {
			set.add(min);
			set.add(max);
			for (let l = Math.ceil(min); l <= Math.floor(max); l++) set.add(l);
		}
	}
	return [...set].map((l) => (Object.is(l, -0) ? 0 : l)).sort((a, b) => a - b);
}

function geometryOf(graph: Graph, entity: Entity): Geometry | null {
	if (!hasInterestingTags(entity.tags)) return null;
	switch (entity.type) {
		case "node":
			return { type: "Point", coordinates: [...entity.loc] };
		case "way": {
			const coordinates = coordinatesOf(graph, entity.nodes);
			if (!coordinates || coordinates.length < 2) return null;
			return isClosed(entity) && isArea(entity.tags)
				? { type: "Polygon", coordinates: [coordinates] }
				: { type: "LineString", coordinates };
		}
		case "relation":
			return entity.tags.type === "multipolygon"
				? multipolygon(graph, entity)
				: null;
	}
}

function coordinatesOf(
	graph: Graph,
	nodes: readonly NodeId[],
): Position[] | null {
	const coordinates: Position[] = [];
	for (const id of nodes) {
		const node = graph.entity(id);
		if (node?.type !== "node") return null;
		coordinates.push([...node.loc]);
	}
	return coordinates;
}

function isClosed(way: Way): boolean {
	return way.nodes.length > 3 && way.nodes[0] === way.nodes.at(-1);
}

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
function isArea(tags: Tags): boolean {
	if (tags.area === "yes") return true;
	if (tags.area === "no") return false;
	if (tags.indoor) return tags.indoor !== "wall" && tags.indoor !== "door";
	if (tags.public_transport === "platform" || tags.railway === "platform")
		return true;
	if (tags.highway === "elevator") return true;
	return Object.keys(tags).some((key) => AREA_KEYS.has(key));
}

function multipolygon(graph: Graph, relation: Relation): MultiPolygon | null {
	const ringsOf = (role: string) =>
		joinRings(
			relation.members
				.filter((m) => m.role === role || (role === "outer" && m.role === ""))
				.map((m) => graph.entity(m.ref))
				.filter((e): e is Way => e?.type === "way")
				.map((w) => w.nodes),
		)
			.map((ring) => coordinatesOf(graph, ring))
			.filter((ring): ring is Position[] => ring !== null);

	const outers = ringsOf("outer");
	if (outers.length === 0) return null;
	const polygons: Position[][][] = outers.map((outer) => [outer]);
	for (const inner of ringsOf("inner")) {
		const point = inner[0];
		const container =
			polygons.find((p) => point && p[0] && pointInRing(point, p[0])) ??
			polygons[0];
		container?.push(inner);
	}
	return { type: "MultiPolygon", coordinates: polygons };
}

/** Joins way node lists end to end into closed rings; unclosable pieces are dropped. */
function joinRings(ways: readonly (readonly NodeId[])[]): NodeId[][] {
	const remaining = ways.filter((w) => w.length > 1).map((w) => [...w]);
	const rings: NodeId[][] = [];
	while (remaining.length > 0) {
		const ring = remaining.shift() as NodeId[];
		while (ring[0] !== ring.at(-1)) {
			const end = ring.at(-1);
			const next = remaining.findIndex((w) => w[0] === end || w.at(-1) === end);
			if (next < 0) break;
			const [way] = remaining.splice(next, 1) as [NodeId[]];
			ring.push(...(way[0] === end ? way : way.reverse()).slice(1));
		}
		if (ring.length > 3 && ring[0] === ring.at(-1)) rings.push(ring);
	}
	return rings;
}
