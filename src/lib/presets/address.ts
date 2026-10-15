/**
 * iD's address field (`ui/fields/address.js`): its rows, and the values suggested from the data
 * around the feature (streets, places, cities and postcodes near it; house numbers of the
 * building it is in).
 */
import type { Entity, EntityId, Loc } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";

/** iD's default address format, used everywhere (IndoorID doesn't know the country). */
export const ADDRESS_ROWS: readonly (readonly string[])[] = [
	["housenumber", "street"],
	["city", "postcode"],
];

/** Share of a row each part takes (iD's default widths). */
export const ADDRESS_WIDTHS: Readonly<Record<string, number>> = {
	housenumber: 1 / 5,
	street: 1 / 2,
	city: 2 / 3,
	postcode: 1 / 3,
};

export interface AddressSuggestion {
	readonly value: string;
	/** Metres from the feature. */
	readonly distance: number;
}

/** Points of an entity (a way's nodes), or none for a relation or a missing node. */
function points(graph: Graph, entity: Entity): Loc[] {
	if (entity.type === "node") return [entity.loc];
	if (entity.type === "way") {
		return entity.nodes.flatMap((id) => {
			const n = graph.entity(id);
			return n?.type === "node" ? [n.loc] : [];
		});
	}
	return [];
}

function bounds(locs: readonly Loc[]): [Loc, Loc] | undefined {
	if (locs.length === 0) return undefined;
	let [w, s] = locs[0] as Loc;
	let [e, n] = locs[0] as Loc;
	for (const [x, y] of locs) {
		w = Math.min(w, x);
		e = Math.max(e, x);
		s = Math.min(s, y);
		n = Math.max(n, y);
	}
	return [
		[w, s],
		[e, n],
	];
}

const EARTH = 6_371_008.8;
const toRad = Math.PI / 180;

/** Metres east and north of `origin`, flat around it (fine within a few hundred metres). */
function local(origin: Loc, [lon, lat]: Loc): [number, number] {
	return [
		(lon - origin[0]) * toRad * EARTH * Math.cos(origin[1] * toRad),
		(lat - origin[1]) * toRad * EARTH,
	];
}

/** Metres from `origin` to the nearest point of a point or line. */
function distanceTo(origin: Loc, locs: readonly Loc[]): number {
	const xy = locs.map((loc) => local(origin, loc));
	if (xy.length === 1) return Math.hypot(...(xy[0] as [number, number]));
	let best = Number.POSITIVE_INFINITY;
	for (let i = 1; i < xy.length; i++) {
		const [ax, ay] = xy[i - 1] as [number, number];
		const [bx, by] = xy[i] as [number, number];
		const dx = bx - ax;
		const dy = by - ay;
		const length2 = dx * dx + dy * dy;
		const t = length2
			? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2))
			: 0;
		best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
	}
	return best;
}

function contains(ring: readonly Loc[], [x, y]: Loc): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i] as Loc;
		const [xj, yj] = ring[j] as Loc;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

const isClosedWay = (entity: Entity) =>
	entity.type === "way" &&
	entity.nodes.length > 3 &&
	entity.nodes[0] === entity.nodes.at(-1);

/**
 * Values for a part of the address (`street`, `place`, `city`, `postcode`, `housenumber`…) taken
 * from the data around the feature, the nearest first, each once.
 */
export function addressSuggestions(
	graph: Graph,
	id: EntityId,
	part: string,
	key = "addr",
): AddressSuggestion[] {
	const entity = graph.entity(id);
	const box = entity && bounds(points(graph, entity));
	if (!entity || !box) return [];
	const center: Loc = [
		(box[0][0] + box[1][0]) / 2,
		(box[0][1] + box[1][1]) / 2,
	];
	const tagKey = `${key}:${part}`;
	const others = [...graph.entities()].filter((e) => e.id !== id);

	/** Features matching `test` within `radius` metres, with their value. */
	const near = (
		test: (e: Entity) => boolean,
		value: (e: Entity) => string | undefined,
		radius = 200,
	): AddressSuggestion[] =>
		others.flatMap((e) => {
			const v = test(e) ? value(e) : undefined;
			const locs = v ? points(graph, e) : [];
			if (!v || locs.length === 0) return [];
			const distance = distanceTo(center, locs);
			return distance <= radius ? [{ value: v, distance }] : [];
		});

	/** Closed ways around the whole feature. */
	const around = (test: (e: Entity) => boolean) =>
		others.filter((e) => {
			if (!test(e) || !isClosedWay(e)) return false;
			const ring = points(graph, e);
			const [[w, s], [east, n]] = box;
			return (
				[
					[w, s],
					[east, s],
					[east, n],
					[w, n],
				] as Loc[]
			).every((corner) => contains(ring, corner));
		});

	let found: AddressSuggestion[];
	switch (part) {
		case "street":
			found = near(
				(e) => e.type === "way" && !!e.tags.highway && !!e.tags.name,
				(e) => e.tags.name,
			);
			break;
		case "place":
			found = near(
				(e) =>
					!!e.tags.name &&
					(!!e.tags.place ||
						(e.tags.boundary === "administrative" &&
							Number(e.tags.admin_level) > 8)),
				(e) => e.tags.name,
			);
			break;
		case "city":
			found = near(
				(e) =>
					!!e.tags[tagKey] ||
					(!!e.tags.name &&
						((e.tags.boundary === "administrative" &&
							e.tags.admin_level === "8") ||
							e.tags.border_type === "city" ||
							["city", "town", "village", "hamlet"].includes(
								e.tags.place ?? "",
							))),
				(e) => e.tags[tagKey] ?? e.tags.name,
			);
			break;
		case "postcode":
			found = [
				...near(
					(e) => !!e.tags[tagKey],
					(e) => e.tags[tagKey],
				),
				...near(
					(e) => !!e.tags.postal_code,
					(e) => e.tags.postal_code,
				),
			];
			break;
		case "housenumber":
		case "housename": {
			// The addresses of the areas the feature is in, and of points in the same building.
			const enclosing = around((e) => !!e.tags[tagKey]).map((e) => ({
				value: e.tags[tagKey] as string,
				distance: 0,
			}));
			const buildings = around(
				(e) => !!e.tags.building && e.tags.building !== "no",
			).map((e) => points(graph, e));
			const inBuilding = near(
				(e) =>
					e.type === "node" &&
					!!e.tags[tagKey] &&
					buildings.some(
						(ring) => contains(ring, e.loc) || ring.includes(e.loc),
					),
				(e) => e.tags[tagKey],
				100,
			);
			return unique([...enclosing, ...inBuilding]).sort((a, b) =>
				a.value > b.value ? 1 : -1,
			);
		}
		default:
			found = near(
				(e) => !!e.tags[tagKey],
				(e) => e.tags[tagKey],
			);
	}
	return unique(found.sort((a, b) => a.distance - b.distance));
}

function unique(list: AddressSuggestion[]): AddressSuggestion[] {
	const seen = new Set<string>();
	return list.filter((s) => !seen.has(s.value) && seen.add(s.value));
}
