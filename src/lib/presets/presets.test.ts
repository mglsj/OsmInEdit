import { describe, expect, it } from "vitest";
import {
	applyPreset,
	type Preset,
	type PresetGeometry,
	PresetIndex,
} from "./presets.ts";

const preset = (
	id: string,
	name: string,
	geometry: PresetGeometry[],
	tags: Record<string, string>,
	extra: Partial<Preset> = {},
): Preset => ({
	id,
	name,
	terms: [],
	geometry,
	tags,
	fields: [],
	moreFields: [],
	...extra,
});

const index = new PresetIndex(
	[
		preset("point", "Point", ["point", "vertex"], {}, { matchScore: 0.1 }),
		preset("line", "Line", ["line"], {}, { matchScore: 0.1 }),
		preset("area", "Area", ["area"], { area: "yes" }, { matchScore: 0.1 }),
		preset(
			"indoor",
			"Indoor Feature",
			["point", "vertex", "line", "area"],
			{ indoor: "*" },
			{
				matchScore: 0.8,
				searchable: false,
			},
		),
		preset(
			"indoor/room",
			"Room",
			["area"],
			{ indoor: "room" },
			{
				matchScore: 0.8,
				terms: ["lobby", "chamber"],
			},
		),
		preset(
			"indoor/stairs",
			"Indoor Stairwell",
			["area"],
			{ indoor: "room", stairs: "yes" },
			{
				matchScore: 0.8,
			},
		),
		preset("amenity/toilets", "Toilets", ["point", "vertex", "area"], {
			amenity: "toilets",
		}),
		preset("entrance", "Entrance/Exit", ["vertex"], { entrance: "*" }),
		preset("highway/steps", "Steps", ["line"], { highway: "steps" }),
	],
	[],
);

describe("PresetIndex.match", () => {
	it.each([
		[{ indoor: "room" }, "area", "indoor/room"],
		[{ indoor: "room", stairs: "yes", level: "0;1" }, "area", "indoor/stairs"],
		[{ indoor: "room", amenity: "toilets" }, "area", "amenity/toilets"],
		[{ indoor: "corridor" }, "area", "indoor"],
		[{ amenity: "toilets" }, "vertex", "amenity/toilets"],
		[{ entrance: "main" }, "vertex", "entrance"],
		[{ entrance: "main" }, "point", "point"],
		[{ highway: "steps" }, "line", "highway/steps"],
		[{ highway: "steps" }, "area", "area"],
		[{}, "line", "line"],
	] as const)("matches %j as a %s with %s", (tags, geometry, id) => {
		expect(index.match(tags, geometry).id).toBe(id);
	});
});

describe("PresetIndex.search", () => {
	const names = (query: string, geometry: PresetGeometry) =>
		index.search(query, geometry).map((p) => p.name);

	it("finds presets by name, the closest match first", () => {
		expect(names("toil", "area")).toEqual(["Toilets"]);
		expect(names("room", "area")).toEqual(["Room"]);
		expect(names("stair", "area")).toEqual(["Indoor Stairwell"]);
	});

	it("finds presets by their search terms", () => {
		expect(names("lobby", "area")).toEqual(["Room"]);
	});

	it("is case and accent insensitive", () => {
		expect(names("TOÏLETS", "point")).toEqual(["Toilets"]);
	});

	it("only lists presets for the geometry, and never unsearchable ones", () => {
		expect(names("steps", "area")).toEqual([]);
		expect(names("indoor", "area")).toEqual(["Indoor Stairwell"]);
	});

	it("returns nothing for an empty query", () => {
		expect(names(" ", "area")).toEqual([]);
	});
});

describe("applyPreset", () => {
	const room = index.preset("indoor/room");
	const stairs = index.preset("indoor/stairs");
	const entrance = index.preset("entrance");
	const door: Preset = {
		...preset("door", "Door", ["vertex"], { door: "*" }),
	};

	it("adds the tags of the new preset and keeps the others", () => {
		expect(
			applyPreset({ indoor: "room", ref: "B12", level: "0" }, room, stairs),
		).toEqual({ indoor: "room", stairs: "yes", ref: "B12", level: "0" });
	});

	it("removes the tags of the old preset", () => {
		expect(
			applyPreset(
				{ indoor: "room", stairs: "yes", level: "0;1" },
				stairs,
				room,
			),
		).toEqual({ indoor: "room", level: "0;1" });
	});

	it("sets yes for a preset that accepts any value, and removes any value of the old one", () => {
		expect(applyPreset({ door: "hinged", width: "1" }, door, entrance)).toEqual(
			{
				width: "1",
				entrance: "yes",
			},
		);
	});

	it("keeps an existing value for a preset that accepts any value", () => {
		expect(applyPreset({ entrance: "main" }, undefined, entrance)).toEqual({
			entrance: "main",
		});
	});
});
