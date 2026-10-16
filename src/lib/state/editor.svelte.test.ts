import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Editor } from "./editor.svelte.ts";

/** An editor with two benches loaded. */
async function loaded() {
	const entities: Entity[] = [
		node("n1", { amenity: "bench", name: "Old" }, [2.35, 48.85]),
		node("n2", { amenity: "bench" }, [2.35, 48.85]),
	];
	const editor = new Editor({
		api: {
			loadMap: async () => entities,
			loadRelation: async () => [],
			upload: async () => {
				throw new Error("no upload");
			},
		},
		minZoom: 16,
	});
	await editor.loadView(
		{ west: 2.349, south: 48.849, east: 2.351, north: 48.851 },
		18,
	);
	return editor;
}

const tagsOf = (editor: Editor, id: EntityId) => editor.graph.entity(id)?.tags;

/** Undoes every step, returning how many there were. */
function undoAll(editor: Editor): number {
	let steps = 0;
	while (editor.canUndo) {
		editor.undo();
		steps++;
	}
	return steps;
}

describe("Editor.setTags: one undo step per field edit, as iD's entity editor", () => {
	it("folds the changes made while typing into one step, which leaving the field closes", async () => {
		const editor = await loaded();
		editor.setTags("n1", { amenity: "bench", name: "N" }, { live: true });
		editor.setTags("n1", { amenity: "bench", name: "New " }, { live: true });
		// Kept as typed while typing.
		expect(tagsOf(editor, "n1")?.name).toBe("New ");
		editor.setTags("n1", { amenity: "bench", name: "New " });
		expect(tagsOf(editor, "n1")?.name).toBe("New");

		// Another edit afterwards is a step of its own.
		editor.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		editor.setTags("n1", { amenity: "bench", name: "Newer" });
		expect(undoAll(editor)).toBe(2);
		expect(tagsOf(editor, "n1")?.name).toBe("Old");
	});

	it("makes no step for tags left as they were", async () => {
		const editor = await loaded();
		editor.setTags("n1", { amenity: "bench", name: " Old " });
		expect(editor.canUndo).toBe(false);
	});

	it("closes the step when leaving the field changed nothing more", async () => {
		const editor = await loaded();
		editor.setTags("n1", { amenity: "bench", name: "New" }, { live: true });
		editor.setTags("n1", { amenity: "bench", name: "New" });
		editor.setTags("n1", { amenity: "bench", name: "Newer" }, { live: true });
		expect(undoAll(editor)).toBe(2);
	});

	it("starts a new step for another feature, or after another edit", async () => {
		const editor = await loaded();
		editor.setTags("n1", { amenity: "bench", name: "A" }, { live: true });
		editor.setTags("n2", { amenity: "bench", name: "B" }, { live: true });
		// Another kind of edit (changing the type, a relation, a fix…).
		editor.perform(changeTags("n2", { amenity: "toilets" }), "Fix");
		editor.setTags("n2", { amenity: "toilets", name: "C" }, { live: true });
		expect(undoAll(editor)).toBe(4);
		expect(tagsOf(editor, "n1")).toEqual({ amenity: "bench", name: "Old" });
	});

	it("starts a new step after an undo, leaving the undone edit to redo", async () => {
		const editor = await loaded();
		editor.setTags("n1", { amenity: "bench", name: "A" });
		editor.setTags("n1", { amenity: "bench", name: "AB" }, { live: true });
		editor.undo();
		editor.setTags("n1", { amenity: "bench", name: "AC" }, { live: true });
		expect(tagsOf(editor, "n1")?.name).toBe("AC");
		editor.undo();
		expect(tagsOf(editor, "n1")?.name).toBe("A");
	});
});
