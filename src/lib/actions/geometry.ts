import type { Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import { type Graph, getEntity } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

/** Creates a node. Get a fresh id from `graph.newId("node")`. */
export function addNode(id: NodeId, loc: Loc, tags: Tags = {}): Action {
	return (graph: Graph) => graph.replace({ type: "node", id, loc, tags });
}

/** Moves a node; every way using it follows, since ways only reference nodes. */
export function moveNode(id: NodeId, loc: Loc): Action {
	return (graph: Graph) =>
		graph.replace({ ...getEntity(graph, id, "node"), loc });
}

/** Creates a way through existing nodes. Repeat the first node at the end for an area. */
export function addWay(
	id: WayId,
	nodes: readonly NodeId[],
	tags: Tags = {},
): Action {
	return (graph: Graph) => {
		for (const node of nodes) getEntity(graph, node, "node");
		return graph.replace({ type: "way", id, nodes, tags });
	};
}

/** Inserts an existing node into a way at `index`, e.g. to put a door on a wall. */
export function insertNodeInWay(
	wayId: WayId,
	nodeId: NodeId,
	index: number,
): Action {
	return (graph: Graph) => {
		const way = getEntity(graph, wayId, "way");
		getEntity(graph, nodeId, "node");
		const nodes = [...way.nodes];
		nodes.splice(index, 0, nodeId);
		return graph.replace({ ...way, nodes });
	};
}
