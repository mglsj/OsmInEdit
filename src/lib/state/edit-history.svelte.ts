/**
 * The OSM graph with its undo history, as the UI sees it: `graph` is replaced (never mutated)
 * on every change. Tag edits made while typing fold into one step (iD's `_coalesceChanges`).
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { type Entity, type EntityId, sameTags } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { type Action, History } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";

export class EditHistory {
	/** Current graph; replaced (never mutated) on every change. */
	graph: Graph;
	/** Number of entities created, modified or deleted since the download or last upload. */
	readonly editCount = $derived.by(() => {
		const { created, modified, deleted } = this.graph.changes();
		return created.length + modified.length + deleted.length;
	});

	#history: History;
	/**
	 * The feature whose field is being typed in: its next tag change replaces the last step
	 * instead of adding one.
	 */
	#typing: EntityId | null = null;

	constructor(base: Graph) {
		this.#history = new History(base);
		this.graph = $state.raw(base);
	}

	get canUndo(): boolean {
		void this.graph; // re-evaluate when the graph changes
		return this.#history.canUndo;
	}

	get canRedo(): boolean {
		void this.graph;
		return this.#history.canRedo;
	}

	perform(action: Action, annotation: string): void {
		this.#typing = null;
		this.graph = this.#history.perform(action, annotation);
	}

	undo(): void {
		this.#typing = null;
		this.#history.undo();
		this.graph = this.#history.graph;
	}

	redo(): void {
		this.#typing = null;
		this.#history.redo();
		this.graph = this.#history.graph;
	}

	/** Typing is over (another feature selected): the next tag change is a step of its own. */
	endTyping(): void {
		this.#typing = null;
	}

	/**
	 * Sets a feature's tags, as iD's entity editor: `live` changes (text being typed) are kept as
	 * typed and fold into one undo step, which the next change that isn't live (leaving the
	 * field) cleans and closes. Tags left as they were make no step.
	 */
	setTags(id: EntityId, tags: Tags, { live = false } = {}): void {
		const entity = this.graph.entity(id);
		if (!entity) return;
		const action = changeTags(id, tags, { clean: !live });
		const changed = action(this.graph).entity(id);
		const typing = this.#typing === id;
		if (changed && sameTags(changed.tags, entity.tags)) {
			if (!live) this.#typing = null;
			return;
		}
		this.graph = typing
			? this.#history.replace(action)
			: this.#history.perform(action, "Change tags");
		this.#typing = live ? id : null;
	}

	/**
	 * Changes tags in the last undo step, as iD does with tags looked up after an edit (the
	 * Wikipedia article of a Wikidata item). Only while the graph is still `after`, the graph
	 * that edit made: anything done since wins.
	 */
	amend(after: Graph, id: EntityId, patch: (tags: Tags) => Tags | null): void {
		if (this.graph !== after) return;
		const entity = this.graph.entity(id);
		const tags = entity && patch(entity.tags);
		if (!tags) return;
		this.graph = this.#history.replace(changeTags(id, tags));
	}

	/** An entity's tags as downloaded, or undefined for a new feature (for a field's revert). */
	downloadedTags(id: EntityId): Tags | undefined {
		return this.#history.base.entity(id)?.tags;
	}

	/** Adds downloaded entities under every step (see `History.merge`). */
	merge(entities: Iterable<Entity>): void {
		this.#history.merge(entities);
		this.graph = this.#history.graph;
	}

	/** Starts a new history from `graph` (the server's state after an upload). */
	reset(graph: Graph): void {
		this.#typing = null;
		this.#history = new History(graph);
		this.graph = graph;
	}
}
