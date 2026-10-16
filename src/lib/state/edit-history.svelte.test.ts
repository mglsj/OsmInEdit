import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "./edit-history.svelte.ts";

/** Two benches, as downloaded. */
const benches = () =>
	new EditHistory(
		Graph.fromEntities([
			node("n1", { amenity: "bench", name: "Old" }, [2.35, 48.85]),
			node("n2", { amenity: "bench" }, [2.35, 48.85]),
		]),
	);

const tagsOf = (history: EditHistory, id: EntityId) =>
	history.graph.entity(id)?.tags;

/** Undoes every step, returning how many there were. */
function undoAll(history: EditHistory): number {
	let steps = 0;
	while (history.canUndo) {
		history.undo();
		steps++;
	}
	return steps;
}

describe("EditHistory.setTags: one undo step per field edit, as iD's entity editor", () => {
	it("folds the changes made while typing into one step, which leaving the field closes", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "N" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "New " }, { live: true });
		// Kept as typed while typing.
		expect(tagsOf(history, "n1")?.name).toBe("New ");
		history.setTags("n1", { amenity: "bench", name: "New " });
		expect(tagsOf(history, "n1")?.name).toBe("New");

		// Another edit afterwards is a step of its own.
		history.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "Newer" });
		expect(undoAll(history)).toBe(2);
		expect(tagsOf(history, "n1")?.name).toBe("Old");
	});

	it("makes no step for tags left as they were", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: " Old " });
		expect(history.canUndo).toBe(false);
	});

	it("closes the step when leaving the field changed nothing more", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "New" }, { live: true });
		history.setTags("n1", { amenity: "bench", name: "New" });
		history.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		expect(undoAll(history)).toBe(2);
	});

	it("starts a new step for another feature, after another edit, or once typing ends", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "A" }, { live: true });
		history.setTags("n2", { amenity: "bench", name: "B" }, { live: true });
		// Another kind of edit (changing the type, a relation, a fix…).
		history.perform(changeTags("n2", { amenity: "toilets" }), "Fix");
		history.setTags("n2", { amenity: "toilets", name: "C" }, { live: true });
		// Another feature selected.
		history.endTyping();
		history.setTags("n2", { amenity: "toilets", name: "CD" }, { live: true });
		expect(undoAll(history)).toBe(5);
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench", name: "Old" });
	});

	it("starts a new step after an undo, leaving the undone edit to redo", () => {
		const history = benches();
		history.setTags("n1", { amenity: "bench", name: "A" });
		history.setTags("n1", { amenity: "bench", name: "AB" }, { live: true });
		history.undo();
		history.setTags("n1", { amenity: "bench", name: "AC" }, { live: true });
		expect(tagsOf(history, "n1")?.name).toBe("AC");
		history.undo();
		expect(tagsOf(history, "n1")?.name).toBe("A");
	});
});

describe("EditHistory", () => {
	it("counts the features changed since the download, and keeps their downloaded tags", () => {
		const history = benches();
		expect(history.editCount).toBe(0);
		history.perform(changeTags("n1", { amenity: "bench" }), "Change tags");
		history.perform(changeTags("n2", { amenity: "toilets" }), "Change tags");
		expect(history.editCount).toBe(2);
		expect(history.downloadedTags("n1")).toEqual({
			amenity: "bench",
			name: "Old",
		});
		expect(history.downloadedTags("n-1")).toBeUndefined();
		history.undo();
		expect(history.editCount).toBe(1);
		expect(history.canRedo).toBe(true);
	});

	it("amends the last step only while the graph is still the one it made", () => {
		const history = benches();
		history.perform(changeTags("n1", { wikidata: "Q1" }), "Change tags");
		const after = history.graph;
		history.amend(after, "n1", (tags) => ({ ...tags, wikipedia: "en:One" }));
		expect(tagsOf(history, "n1")).toEqual({
			wikidata: "Q1",
			wikipedia: "en:One",
		});
		expect(undoAll(history)).toBe(1);

		// Something done since wins.
		history.perform(changeTags("n1", { wikidata: "Q2" }), "Change tags");
		const stale = history.graph;
		history.perform(changeTags("n1", { name: "Other" }), "Change tags");
		history.amend(stale, "n1", (tags) => ({ ...tags, wikipedia: "en:Two" }));
		expect(tagsOf(history, "n1")).toEqual({ name: "Other" });
	});

	it("takes downloaded data under the edits, and starts again from an uploaded graph", () => {
		const history = benches();
		history.perform(changeTags("n1", { amenity: "bench" }), "Change tags");
		history.merge([node("n3", { amenity: "toilets" }, [2.35, 48.85])]);
		expect(tagsOf(history, "n3")).toEqual({ amenity: "toilets" });
		expect(tagsOf(history, "n1")).toEqual({ amenity: "bench" });
		expect(history.editCount).toBe(1);

		history.reset(Graph.fromEntities([node("n1", { amenity: "bench" })]));
		expect(history.editCount).toBe(0);
		expect(history.canUndo).toBe(false);
		expect(tagsOf(history, "n2")).toBeUndefined();
	});
});
