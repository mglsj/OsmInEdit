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
		const graph = action(this.graph);
		this.#steps = this.#steps.slice(0, this.#index + 1);
		this.#steps.push({ graph, annotation });
		this.#index++;
		return graph;
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
