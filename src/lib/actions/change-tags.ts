import type { EntityId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { Action } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

/**
 * Sets the tags of an entity. Keys and values are trimmed, and empty ones dropped: OSM
 * rejects them. Tags are taken as given, never reinterpreted, so values the editor doesn't
 * understand (e.g. `level=G`) survive untouched.
 */
export function changeTags(id: EntityId, tags: Tags): Action {
	return (graph: Graph) => {
		const entity = graph.entity(id);
		if (!entity) throw new Error(`Unknown entity ${id}`);
		return graph.replace({ ...entity, tags: cleanTags(tags) });
	};
}

function cleanTags(tags: Tags): Tags {
	const clean: Record<string, string> = {};
	for (const [key, value] of Object.entries(tags)) {
		const k = key.trim();
		const v = value.trim();
		if (k && v) clean[k] = v;
	}
	return clean;
}
