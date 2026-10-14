import { describe, expect, it } from "vitest";
import { formatTagText, parseTagText } from "./tag-text.ts";

describe("formatTagText", () => {
	it("writes one key=value per line, sorted by key", () => {
		expect(formatTagText({ name: "Library", indoor: "room", level: "0" })).toBe(
			"indoor=room\nlevel=0\nname=Library",
		);
	});
});

describe("parseTagText", () => {
	it("reads key=value lines", () => {
		expect(parseTagText("indoor=room\nlevel=0;1")).toEqual({
			indoor: "room",
			level: "0;1",
		});
	});

	it("splits on the first = only and trims", () => {
		expect(parseTagText("  note = a=b \n")).toEqual({ note: "a=b" });
	});

	it("ignores blank lines and lines without a key or value", () => {
		expect(parseTagText("\nname=\n=orphan\nnot a tag\nref=B12\n")).toEqual({
			ref: "B12",
		});
	});

	it("keeps the last value of a repeated key", () => {
		expect(parseTagText("level=0\nlevel=1")).toEqual({ level: "1" });
	});
});
