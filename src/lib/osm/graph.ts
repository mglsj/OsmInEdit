import {
	type Entity,
	type EntityId,
	type EntityType,
	isNewId,
	makeId,
	type NodeId,
	osmId,
	type Relation,
	type RelationId,
	sameContent,
	type Way,
	type WayId,
} from "./entity.ts";

type ParentIndex = ReadonlyMap<EntityId, ReadonlySet<EntityId>>;

/** Server data shared by every graph derived from it, with lazily built parent indexes. */
class BaseData {
	#parentWays?: ParentIndex;
	#parentRelations?: ParentIndex;

	constructor(readonly entities: ReadonlyMap<EntityId, Entity>) {}

	get parentWays(): ParentIndex {
		this.#parentWays ??= buildParentWays(this.entities.values());
		return this.#parentWays;
	}

	get parentRelations(): ParentIndex {
		this.#parentRelations ??= buildParentRelations(this.entities.values());
		return this.#parentRelations;
	}
}

export interface Changes {
	readonly created: readonly Entity[];
	readonly modified: readonly Entity[];
	/** The base version of each deleted entity. */
	readonly deleted: readonly Entity[];
}

/**
 * An immutable set of OSM entities: the server data (base) plus local edits. Every change
 * returns a new graph, so history is a list of graphs and undo never has to revert anything.
 */
export class Graph {
	readonly #base: BaseData;
	readonly #local: ReadonlyMap<EntityId, Entity | null>;
	readonly #nextId: number;
	#localParentWays?: ParentIndex;
	#localParentRelations?: ParentIndex;

	private constructor(
		base: BaseData,
		local: ReadonlyMap<EntityId, Entity | null>,
		nextId: number,
	) {
		this.#base = base;
		this.#local = local;
		this.#nextId = nextId;
	}

	static fromEntities(entities: Iterable<Entity>): Graph {
		const map = new Map<EntityId, Entity>();
		let nextId = -1;
		for (const entity of entities) {
			map.set(entity.id, entity);
			nextId = Math.min(nextId, osmId(entity.id) - 1);
		}
		return new Graph(new BaseData(map), new Map(), nextId);
	}

	entity(id: EntityId): Entity | undefined {
		const local = this.#local.get(id);
		if (local !== undefined) return local ?? undefined;
		return this.#base.entities.get(id);
	}

	/** Every entity currently in the graph. */
	*entities(): Generator<Entity> {
		for (const [id, entity] of this.#base.entities) {
			if (!this.#local.has(id)) yield entity;
		}
		for (const entity of this.#local.values()) {
			if (entity) yield entity;
		}
	}

	/** Adds or updates an entity. */
	replace(entity: Entity): Graph {
		const local = new Map(this.#local).set(entity.id, entity);
		const nextId = isNewId(entity.id)
			? Math.min(this.#nextId, osmId(entity.id) - 1)
			: this.#nextId;
		return new Graph(this.#base, local, nextId);
	}

	remove(id: EntityId): Graph {
		const local = new Map(this.#local).set(id, null);
		return new Graph(this.#base, local, this.#nextId);
	}

	/** An id that no entity of this graph, or of the graphs it derives from, has used. */
	newId(type: "node"): NodeId;
	newId(type: "way"): WayId;
	newId(type: "relation"): RelationId;
	newId(type: EntityType): EntityId;
	newId(type: EntityType): EntityId {
		return makeId(type, this.#nextId);
	}

	/** Whether the entity was created, modified or deleted locally. */
	isEdited(id: EntityId): boolean {
		return this.#local.has(id);
	}

	/** This graph's server data with `entities` added or replaced, without local edits. */
	withBaseEntities(entities: Iterable<Entity>): Graph {
		const map = new Map(this.#base.entities);
		let nextId = this.#nextId;
		for (const entity of entities) {
			map.set(entity.id, entity);
			nextId = Math.min(nextId, osmId(entity.id) - 1);
		}
		return new Graph(new BaseData(map), new Map(), nextId);
	}

	/** The same local edits, applied on the server data of `base`. */
	rebaseOnto(base: Graph): Graph {
		return new Graph(
			base.#base,
			this.#local,
			Math.min(this.#nextId, base.#nextId),
		);
	}

	/** The graph of server data, without local edits. */
	base(): Graph {
		return new Graph(this.#base, new Map(), this.#nextId);
	}

	parentWays(id: NodeId): Way[] {
		return this.#parents(
			id,
			this.#base.parentWays,
			this.#localIndexes().ways,
		).filter((e): e is Way => e.type === "way" && e.nodes.includes(id));
	}

	parentRelations(id: EntityId): Relation[] {
		return this.#parents(
			id,
			this.#base.parentRelations,
			this.#localIndexes().relations,
		).filter(
			(e): e is Relation =>
				e.type === "relation" && e.members.some((m) => m.ref === id),
		);
	}

	/**
	 * The entities added, changed or removed since `other` (by identity: an entity put back as
	 * it was isn't listed). Cheap between graphs of one history; after a download (another
	 * server data) every entity is compared.
	 */
	changedSince(other: Graph): Set<EntityId> {
		const changed = new Set<EntityId>();
		const check = (id: EntityId) => {
			if (this.entity(id) !== other.entity(id)) changed.add(id);
		};
		if (this.#base !== other.#base) {
			for (const id of this.#base.entities.keys()) check(id);
			for (const id of other.#base.entities.keys()) check(id);
		}
		for (const id of this.#local.keys()) check(id);
		for (const id of other.#local.keys()) check(id);
		return changed;
	}

	/** Local edits compared to the server data. */
	changes(): Changes {
		const created: Entity[] = [];
		const modified: Entity[] = [];
		const deleted: Entity[] = [];
		for (const [id, entity] of this.#local) {
			const base = this.#base.entities.get(id);
			if (entity && !base) created.push(entity);
			else if (entity && base && !sameContent(entity, base))
				modified.push(entity);
			else if (!entity && base) deleted.push(base);
		}
		return { created, modified, deleted };
	}

	hasChanges(): boolean {
		const { created, modified, deleted } = this.changes();
		return created.length + modified.length + deleted.length > 0;
	}

	#parents(id: EntityId, base: ParentIndex, local: ParentIndex): Entity[] {
		const ids = new Set([...(base.get(id) ?? []), ...(local.get(id) ?? [])]);
		const parents: Entity[] = [];
		for (const parentId of ids) {
			const parent = this.entity(parentId);
			if (parent) parents.push(parent);
		}
		return parents;
	}

	#localIndexes(): { ways: ParentIndex; relations: ParentIndex } {
		const entities = [...this.#local.values()].filter((e) => e !== null);
		this.#localParentWays ??= buildParentWays(entities);
		this.#localParentRelations ??= buildParentRelations(entities);
		return {
			ways: this.#localParentWays,
			relations: this.#localParentRelations,
		};
	}
}

function buildParentWays(entities: Iterable<Entity>): ParentIndex {
	const index = new Map<EntityId, Set<EntityId>>();
	for (const entity of entities) {
		if (entity.type !== "way") continue;
		for (const node of entity.nodes) addTo(index, node, entity.id);
	}
	return index;
}

function buildParentRelations(entities: Iterable<Entity>): ParentIndex {
	const index = new Map<EntityId, Set<EntityId>>();
	for (const entity of entities) {
		if (entity.type !== "relation") continue;
		for (const member of entity.members) addTo(index, member.ref, entity.id);
	}
	return index;
}

function addTo(
	index: Map<EntityId, Set<EntityId>>,
	key: EntityId,
	value: EntityId,
) {
	let set = index.get(key);
	if (!set) {
		set = new Set();
		index.set(key, set);
	}
	set.add(value);
}

/** Returns the entity, or throws if the graph doesn't have it. */
export function getEntity<T extends Entity["type"]>(
	graph: Graph,
	id: EntityId,
	type: T,
): Extract<Entity, { type: T }> {
	const entity = graph.entity(id);
	if (entity?.type !== type) throw new Error(`Unknown ${type} ${id}`);
	return entity as Extract<Entity, { type: T }>;
}
