/**
 * The map's features kept from one graph to the next: after an edit only the features of the
 * changed entities, and of those drawn from them, are built again (P5.2). A feature's `@lv`
 * depends on the levels of the whole data, so when those change every feature is encoded
 * again, as in a full build.
 */
import type { FeatureCollection, Geometry } from "geojson";
import type { EntityId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import {
	type BuildOptions,
	draftOf,
	encodeFeature,
	type FeatureDraft,
	type FeatureProperties,
	type IndoorFeature,
	knownLevels,
} from "./features.ts";

export interface StoredFeatures {
	/** Every feature by entity id; a feature left alone stays the same object. */
	readonly byId: ReadonlyMap<string, IndoorFeature>;
	/** Every level present in the data, sorted (see `buildFeatures`). */
	readonly levels: number[];
	/** All the features, for a full `setData`. */
	readonly collection: FeatureCollection<Geometry, FeatureProperties>;
}

export class FeatureStore {
	#graph: Graph | null = null;
	#options: BuildOptions = {};
	readonly #drafts = new Map<EntityId, FeatureDraft>();
	readonly #features = new Map<string, IndoorFeature>();
	#levels: number[] = [];
	#result: StoredFeatures | null = null;

	/** The features of `graph`, building again only what changed since the last call. */
	update(graph: Graph, options: BuildOptions = {}): StoredFeatures {
		const previous = this.#graph;
		const full =
			!previous ||
			options.presets !== this.#options.presets ||
			options.icons !== this.#options.icons;
		this.#graph = graph;
		this.#options = options;
		if (full) {
			this.#drafts.clear();
			for (const entity of graph.entities()) this.#redraft(entity.id);
		} else {
			const changed = graph.changedSince(previous);
			if (changed.size === 0 && this.#result) return this.#result;
			for (const id of affectedBy(changed, graph, previous)) this.#redraft(id);
		}

		const levels = knownLevels([...this.#drafts.values()].map((d) => d.levels));
		if (full || !sameNumbers(levels, this.#levels)) {
			this.#levels = levels;
			this.#features.clear();
			for (const [id, draft] of this.#drafts) {
				this.#features.set(id, encodeFeature(draft, levels));
			}
		}
		const features = this.#features;
		const result: StoredFeatures = {
			byId: features,
			levels: this.#levels,
			get collection() {
				return {
					type: "FeatureCollection" as const,
					features: [...features.values()],
				};
			},
		};
		this.#result = result;
		return result;
	}

	/** Builds an entity's feature again, or drops it. */
	#redraft(id: EntityId): void {
		const graph = this.#graph as Graph;
		const entity = graph.entity(id);
		const draft = entity ? draftOf(graph, entity, this.#options) : null;
		if (draft) {
			this.#drafts.set(id, draft);
			this.#features.set(id, encodeFeature(draft, this.#levels));
		} else {
			this.#drafts.delete(id);
			this.#features.delete(id);
		}
	}
}

/**
 * The entities whose features may differ after `changed` changed, in either graph: the ways
 * of a node and their relations, the nodes of a way (a point turns into a vertex), the
 * members of a relation (its `level` reaches them) and the relations of anything.
 */
function affectedBy(
	changed: ReadonlySet<EntityId>,
	graph: Graph,
	previous: Graph,
): Set<EntityId> {
	const affected = new Set(changed);
	for (const id of changed) {
		for (const g of [graph, previous]) {
			const entity = g.entity(id);
			if (!entity) continue;
			switch (entity.type) {
				case "node":
					for (const way of g.parentWays(entity.id)) {
						affected.add(way.id);
						for (const r of g.parentRelations(way.id)) affected.add(r.id);
					}
					break;
				case "way":
					for (const node of entity.nodes) affected.add(node);
					break;
				case "relation":
					for (const member of entity.members) affected.add(member.ref);
					break;
			}
			for (const r of g.parentRelations(id)) affected.add(r.id);
		}
	}
	return affected;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** What to send the map so it holds `next`, given that it holds `sent`. */
export function diffFeatures(
	sent: ReadonlyMap<string, IndoorFeature>,
	next: ReadonlyMap<string, IndoorFeature>,
): { add: IndoorFeature[]; remove: string[] } {
	const add: IndoorFeature[] = [];
	const remove: string[] = [];
	for (const [id, feature] of next) {
		if (sent.get(id) !== feature) add.push(feature);
	}
	for (const id of sent.keys()) {
		if (!next.has(id)) remove.push(id);
	}
	return { add, remove };
}
