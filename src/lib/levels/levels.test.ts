import { describe, expect, it } from "vitest";
import { formatLevels, isOnLevel, parseLevels } from "./levels.ts";

const single = (level: number) => ({ min: level, max: level });

describe("parseLevels", () => {
	it.each([
		["0", [single(0)]],
		["-1", [single(-1)]],
		["2", [single(2)]],
		["0.5", [single(0.5)]],
		["-0.5", [single(-0.5)]],
	])("reads the single level %j", (value, expected) => {
		expect(parseLevels(value)).toEqual(expected);
	});

	it("reads a list of levels, sorted", () => {
		expect(parseLevels("2;0;1")).toEqual([single(0), single(1), single(2)]);
	});

	it("keeps listed levels distinct: 0;1 does not include a 0.5 mezzanine", () => {
		expect(parseLevels("0;1")).toEqual([single(0), single(1)]);
	});

	it.each([
		["0-2", [{ min: 0, max: 2 }]],
		["-2--1", [{ min: -2, max: -1 }]],
		["-1-3", [{ min: -1, max: 3 }]],
		["0.5-1.5", [{ min: 0.5, max: 1.5 }]],
		["3-1", [{ min: 1, max: 3 }]],
	])("reads the range %j", (value, expected) => {
		expect(parseLevels(value)).toEqual(expected);
	});

	it("reads lists mixing levels and ranges", () => {
		expect(parseLevels("-1;2-3")).toEqual([single(-1), { min: 2, max: 3 }]);
	});

	it("merges duplicates and overlapping ranges", () => {
		expect(parseLevels("1;0-2;1;5")).toEqual([{ min: 0, max: 2 }, single(5)]);
	});

	it("tolerates spaces around values", () => {
		expect(parseLevels(" 1 ; 2 ")).toEqual([single(1), single(2)]);
	});

	it.each([
		[""],
		[" "],
		["G"],
		["ground"],
		["1;"],
		[";1"],
		["1;;2"],
		["1-"],
		["1--"],
		["0-1-2"],
		["1.2.3"],
		// A comma is ambiguous (list or decimal comma): don't guess, validation will flag it.
		["1,5"],
		["0,1"],
	])("rejects %j", (value) => {
		expect(parseLevels(value)).toBeNull();
	});
});

describe("formatLevels", () => {
	it.each([
		[[single(0)], "0"],
		[[single(-1)], "-1"],
		[[single(0.5)], "0.5"],
		[[single(0), single(1), single(2)], "0;1;2"],
		[[{ min: 0, max: 2 }], "0-2"],
		[[{ min: -2, max: -1 }], "-2--1"],
		[[{ min: 0.5, max: 1.5 }], "0.5-1.5"],
		[[single(-1), { min: 2, max: 3 }], "-1;2-3"],
	])("writes %j as %j", (levels, expected) => {
		expect(formatLevels(levels)).toBe(expected);
	});

	it.each([["0"], ["-1;0;1"], ["0-2"], ["-2--1"], ["0.5-1.5"], ["-1;0.5;2-4"]])(
		"round-trips %j",
		(value) => {
			const levels = parseLevels(value);
			expect(levels).not.toBeNull();
			expect(formatLevels(levels ?? [])).toBe(value);
		},
	);
});

describe("isOnLevel", () => {
	const levels = parseLevels("-1;0-2") ?? [];

	it("is true for listed levels and anything inside a range", () => {
		expect(isOnLevel(levels, -1)).toBe(true);
		expect(isOnLevel(levels, 0)).toBe(true);
		expect(isOnLevel(levels, 0.5)).toBe(true);
		expect(isOnLevel(levels, 2)).toBe(true);
	});

	it("is false between listed levels and outside ranges", () => {
		expect(isOnLevel(levels, -0.5)).toBe(false);
		expect(isOnLevel(levels, 3)).toBe(false);
		expect(isOnLevel(levels, -2)).toBe(false);
	});
});
