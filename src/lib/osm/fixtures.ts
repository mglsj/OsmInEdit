/** Builders for entities in tests. Server entities get version 1. */
import type {
	Loc,
	Member,
	Node,
	NodeId,
	Relation,
	RelationId,
	Way,
	WayId,
} from "./entity.ts";
import type { Tags } from "./tags.ts";

export function node(id: NodeId, tags: Tags = {}, loc: Loc = [0, 0]): Node {
	return { type: "node", id, version: 1, tags, loc };
}

export function way(id: WayId, nodes: NodeId[], tags: Tags = {}): Way {
	return { type: "way", id, version: 1, tags, nodes };
}

export function relation(
	id: RelationId,
	members: Member[],
	tags: Tags = { type: "multipolygon" },
): Relation {
	return { type: "relation", id, version: 1, tags, members };
}
