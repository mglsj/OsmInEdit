import { describe, expect, it } from "vitest";
import { loadPresetIndex } from "./load.ts";

/** Checks the presets generated from iD's schema cover Simple Indoor Tagging. */
describe("generated presets", async () => {
	const index = await loadPresetIndex();

	it.each([
		[{ indoor: "room" }, "area", "Room"],
		[
			{ indoor: "room", stairs: "yes", level: "0;1" },
			"area",
			"Indoor Stairwell",
		],
		[{ indoor: "room", elevator: "yes" }, "area", "Indoor Elevator Shaft"],
		[{ indoor: "corridor" }, "area", "Indoor Corridor"],
		[{ indoor: "area" }, "area", "Indoor Area"],
		[{ indoor: "level", level: "1" }, "area", "Indoor Level Outline"],
		[{ indoor: "wall" }, "line", "Indoor Wall"],
		[{ door: "hinged" }, "vertex", "Door"],
		[{ entrance: "main" }, "vertex", "Main Entrance"],
		[{ highway: "elevator" }, "vertex", "Elevator"],
		[{ indoor: "room", amenity: "toilets" }, "area", "Restroom"],
	] as const)("names %j (%s) %j", (tags, geometry, name) => {
		expect(index.match(tags, geometry).name).toBe(name);
	});

	it("has the indoor fields, with labels", () => {
		const { fields } = index.fieldsOf(index.match({ indoor: "room" }, "area"));
		expect(fields.map((f) => f.key)).toEqual(
			expect.arrayContaining(["level", "name", "ref"]),
		);
		expect(fields.find((f) => f.key === "level")?.label).toBe("Level");
	});

	it("finds rooms by name", () => {
		expect(index.search("room", "area")[0]?.name).toBe("Room");
	});
});
