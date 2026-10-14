import { describe, expect, it } from "vitest";
import type { Node } from "./entity.ts";
import { Graph } from "./graph.ts";
import { History } from "./history.ts";

const bench: Node = {
	type: "node",
	id: "n1",
	version: 1,
	tags: {},
	loc: [0, 0],
};
const retag = (tags: Record<string, string>) => (graph: Graph) =>
	graph.replace({ ...bench, tags });

describe("History", () => {
	it("applies actions and undoes and redoes them in order", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.perform(retag({ amenity: "chair" }), "Tag as chair");

		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "chair" });
		expect(history.undo()).toBe("Tag as chair");
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
		expect(history.undo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({});
		expect(history.undo()).toBeNull();

		expect(history.redo()).toBe("Tag as bench");
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
	});

	it("drops the redo stack when a new action is performed", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		history.undo();
		history.perform(retag({ amenity: "chair" }), "Tag as chair");

		expect(history.canRedo).toBe(false);
		expect(history.redo()).toBeNull();
		expect(history.graph.entity("n1")?.tags).toEqual({ amenity: "chair" });
	});

	it("keeps the base graph to compare edits against", () => {
		const history = new History(Graph.fromEntities([bench]));
		history.perform(retag({ amenity: "bench" }), "Tag as bench");
		expect(history.base.entity("n1")?.tags).toEqual({});
		expect(history.hasChanges).toBe(true);
		history.undo();
		expect(history.hasChanges).toBe(false);
	});
});
