import { describe, expect, it } from "vitest";
import { BUILDING_COLOR, PLAN_COLORS, pickColor } from "./colors.ts";

const values = PLAN_COLORS.map((c) => c.value);

function rgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Euclidean distance between two colours in RGB, 0 to 441. */
function apart(a: string, b: string): number {
	const [r1, g1, b1] = rgb(a);
	const [r2, g2, b2] = rgb(b);
	return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

describe("PLAN_COLORS", () => {
	it("are told apart from each other and from the buildings' pink", () => {
		expect(values).not.toContain(BUILDING_COLOR);
		for (const [i, a] of values.entries()) {
			expect(apart(a, BUILDING_COLOR)).toBeGreaterThan(90);
			for (const b of values.slice(i + 1)) {
				expect(apart(a, b)).toBeGreaterThan(60);
			}
		}
	});

	it("each have a name, for the colour picker", () => {
		const names = PLAN_COLORS.map((c) => c.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names.every((n) => n.length > 0)).toBe(true);
	});
});

describe("pickColor", () => {
	it("picks at random among the colours no plan has yet", () => {
		expect(pickColor([], () => 0)).toBe(values[0]);
		expect(pickColor([], () => 0.999)).toBe(values.at(-1));

		const [free, ...taken] = [values[3], ...values.filter((_, i) => i !== 3)];
		expect(pickColor(taken as string[], () => 0)).toBe(free);
		expect(pickColor(taken as string[], () => 0.999)).toBe(free);
	});

	it("reuses one at random once every colour is taken", () => {
		expect(pickColor(values, () => 0)).toBe(values[0]);
		expect(pickColor(values, () => 0.999)).toBe(values.at(-1));
	});

	it("ignores colours not in the palette, and never picks the buildings' pink", () => {
		expect(pickColor([BUILDING_COLOR, "#123456"], () => 0)).toBe(values[0]);
		for (let r = 0; r < 1; r += 0.05) {
			expect(pickColor([], () => r)).not.toBe(BUILDING_COLOR);
		}
	});
});
