import { describe, expect, it } from "vitest";
import { chipsIn, combineTags, isMixed } from "./multi.ts";

describe("combineTags: the tags of several features, as one editor shows them", () => {
	it("gives one feature's tags as they are, nothing mixed", () => {
		const combined = combineTags([{ indoor: "room", level: "0" }]);
		expect(combined.tags).toEqual({ indoor: "room", level: "0" });
		expect(combined.mixed.size).toBe(0);
	});

	it("keeps the values all features share, and lists each feature's value of the others", () => {
		const combined = combineTags([
			{ indoor: "room", level: "0", name: "A" },
			{ indoor: "room", level: "1" },
			{ indoor: "room", level: "0", name: "A" },
		]);
		expect(combined.tags).toEqual({ indoor: "room" });
		expect(combined.mixed.get("level")).toEqual(["0", "1", "0"]);
		// A key only some features have is mixed too.
		expect(combined.mixed.get("name")).toEqual(["A", undefined, "A"]);
		expect(isMixed(combined, "level")).toBe(true);
		expect(isMixed(combined, "indoor")).toBe(false);
	});

	it("has nothing for no feature", () => {
		const combined = combineTags([]);
		expect(combined.tags).toEqual({});
		expect(combined.mixed.size).toBe(0);
	});
});

describe("chipsIn: a list field's values over several features", () => {
	it("tells the values every feature has from those only some have", () => {
		const combined = combineTags([
			{ cuisine: "pizza;burger" },
			{ cuisine: "burger" },
			{},
		]);
		expect(chipsIn(combined, "cuisine")).toEqual([
			{ value: "pizza", all: false },
			{ value: "burger", all: false },
		]);
		expect(
			chipsIn(
				combineTags([{ cuisine: "pizza;burger" }, { cuisine: "burger;sushi" }]),
				"cuisine",
			),
		).toEqual([
			{ value: "pizza", all: false },
			{ value: "burger", all: true },
			{ value: "sushi", all: false },
		]);
	});

	it("gives a shared list's values, all of them on every feature", () => {
		expect(
			chipsIn(combineTags([{ cuisine: "pizza; sushi" }]), "cuisine"),
		).toEqual([
			{ value: "pizza", all: true },
			{ value: "sushi", all: true },
		]);
		expect(chipsIn(combineTags([{}]), "cuisine")).toEqual([]);
	});
});
