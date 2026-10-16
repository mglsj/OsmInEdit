import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveText } from "./live-text.ts";

describe("liveText", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("applies the last text typed once typing pauses for 150 ms", () => {
		const applied: string[] = [];
		const live = liveText((text) => applied.push(text));
		live.typed("N");
		vi.advanceTimersByTime(100);
		live.typed("Na");
		vi.advanceTimersByTime(149);
		expect(applied).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(applied).toEqual(["Na"]);
		expect(live.cancel()).toBe(false);
	});

	it("drops the text waiting when the field is left (it is applied there)", () => {
		const applied: string[] = [];
		const live = liveText((text) => applied.push(text));
		live.typed("N");
		expect(live.cancel()).toBe(true);
		vi.advanceTimersByTime(500);
		expect(applied).toEqual([]);
	});
});
