import type { Entity, EntityId } from "./entity.ts";
import type { Graph } from "./graph.ts";

/** A change to the graph. Actions are pure: they return a new graph. */
export type Action = (graph: Graph) => Graph;

interface Step {
	readonly graph: Graph;
	readonly annotation: string | null;
}

/** Undo/redo as a list of graph snapshots. */
export class History {
	#steps: Step[];
	#index = 0;

	constructor(base: Graph) {
		this.#steps = [{ graph: base, annotation: null }];
	}

	get graph(): Graph {
		return this.#current.graph;
	}

	/** The graph before any edit. */
	get base(): Graph {
		return this.#first.graph;
	}

	get canUndo(): boolean {
		return this.#index > 0;
	}

	get canRedo(): boolean {
		return this.#index < this.#steps.length - 1;
	}

	get hasChanges(): boolean {
		return this.graph.hasChanges();
	}

	/** Applies an action, labelled for the undo button, and drops anything that could be redone. */
	perform(action: Action, annotation: string): Graph {
		const graph = this.graph.update(action);
		this.#steps = this.#steps.slice(0, this.#index + 1);
		this.#steps.push({ graph, annotation });
		this.#index++;
		return graph;
	}

	/**
	 * Applies an action to the current step instead of adding one, so one undo takes back both
	 * (iD's `replace`: a Wikipedia tag following a Wikidata choice). Performs it when there is
	 * no step to fold it into.
	 */
	replace(action: Action): Graph {
		const step = this.#current;
		if (this.#index === 0 || step.annotation === null) {
			return this.perform(action, "Change tags");
		}
		const graph = step.graph.update(action);
		this.#steps = [
			...this.#steps.slice(0, this.#index),
			{ graph, annotation: step.annotation },
		];
		return graph;
	}

	/**
	 * Adds downloaded entities to the server data of every step. Entities already known in the
	 * same or a newer version are ignored. A newer version of an entity edited locally is not
	 * taken: the local edit stays, the upload will be refused for it, and it is reported here.
	 */
	merge(entities: Iterable<Entity>): { conflicts: EntityId[] } {
		const base = this.base;
		const accepted: Entity[] = [];
		const conflicts: EntityId[] = [];
		for (const entity of entities) {
			const known = base.entity(entity.id);
			if (known && (known.version ?? 0) >= (entity.version ?? 0)) continue;
			if (this.#steps.some((step) => step.graph.isEdited(entity.id))) {
				conflicts.push(entity.id);
			} else {
				accepted.push(entity);
			}
		}
		if (accepted.length > 0) {
			const merged = base.withBaseEntities(accepted);
			this.#steps = this.#steps.map((step) => ({
				...step,
				graph: step.graph.rebaseOnto(merged),
			}));
		}
		return { conflicts };
	}

	/** Returns the annotation of the undone action, or null if there was nothing to undo. */
	undo(): string | null {
		if (!this.canUndo) return null;
		const { annotation } = this.#current;
		this.#index--;
		return annotation;
	}

	/** Returns the annotation of the redone action, or null if there was nothing to redo. */
	redo(): string | null {
		if (!this.canRedo) return null;
		this.#index++;
		return this.#current.annotation;
	}

	get #current(): Step {
		return this.#steps[this.#index] as Step;
	}

	get #first(): Step {
		return this.#steps[0] as Step;
	}
}
