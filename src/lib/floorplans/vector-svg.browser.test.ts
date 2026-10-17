import { describe, expect, it } from "vitest";
import { MessageError } from "#lib/i18n/messages.ts";
import type { VectorContent } from "./vector.ts";
import { extractSvg } from "./vector-svg.ts";

const svg = (
	body: string,
	attrs = 'width="200" height="100" viewBox="0 0 400 200"',
) =>
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;

function filledArea({ triangles: t }: VectorContent): number {
	let area = 0;
	for (let i = 0; i < t.length; i += 6) {
		area +=
			Math.abs(
				((t[i + 2] ?? 0) - (t[i] ?? 0)) * ((t[i + 5] ?? 0) - (t[i + 1] ?? 0)) -
					((t[i + 4] ?? 0) - (t[i] ?? 0)) * ((t[i + 3] ?? 0) - (t[i + 1] ?? 0)),
			) / 2;
	}
	return area;
}

const segments = ({ segments: s }: VectorContent) =>
	Array.from({ length: s.length / 4 }, (_, i) => [
		...s.subarray(i * 4, i * 4 + 4),
	]);

describe("extractSvg (in Chromium)", () => {
	it("measures the drawing in its own size, its viewBox scaled into it", () => {
		const content = extractSvg(
			svg('<rect width="200" height="100" fill="red"/>'),
		);
		expect(content.size).toEqual({ width: 200, height: 100 });
		// 200 × 100 user units, half size.
		expect(filledArea(content)).toBeCloseTo(100 * 50, 6);
		expect(content.styles).toEqual([
			{ color: [255, 0, 0, 255], width: 0, layer: -1 },
		]);
	});

	it("strokes through group transforms, widths scaled with them", () => {
		const content = extractSvg(
			svg(
				'<g transform="translate(20 0)" stroke="blue" stroke-width="4" fill="none"><path d="M0 0 H100"/></g>',
			),
		);
		expect(segments(content)).toEqual([[10, 0, 60, 0]]);
		expect(content.styles).toEqual([
			{ color: [0, 0, 255, 255], width: 2, layer: -1 },
		]);
		expect(content.triangles).toHaveLength(0);
	});

	it("reads colours in any CSS form, with their opacities", () => {
		const content = extractSvg(
			svg(
				'<rect width="10" height="10" fill="rgb(0, 128, 0)" fill-opacity="0.5"/>' +
					'<g opacity="0.5"><rect width="10" height="10" style="fill: orange"/></g>',
			),
		);
		expect(content.styles.map((s) => s.color)).toEqual([
			[0, 128, 0, 128],
			[255, 165, 0, 128],
		]);
	});

	it("draws what <use> refers to, and skips definitions and hidden elements", () => {
		const content = extractSvg(
			svg(
				'<defs><rect id="box" width="20" height="20" fill="black"/></defs>' +
					'<use href="#box" x="100"/>' +
					'<g style="display:none"><rect width="400" height="200"/></g>' +
					'<rect width="400" height="200" visibility="hidden"/>',
				'width="400" height="200"',
			),
		);
		expect(filledArea(content)).toBeCloseTo(400, 6);
		expect(Math.min(...content.triangles.filter((_, i) => i % 2 === 0))).toBe(
			100,
		);
	});

	it("measures a drawing without a size by its viewBox", () => {
		expect(extractSvg(svg("", 'viewBox="0 0 640 480"')).size).toEqual({
			width: 640,
			height: 480,
		});
	});

	it("reads the test plan: a green rectangle over 400 × 300, its script never run", () => {
		const text =
			'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" onload="window.svgRan = true">' +
			'<script>window.svgRan = true;</script><rect width="400" height="300" fill="#00ff00"/></svg>';
		const content = extractSvg(text);
		expect(content.size).toEqual({ width: 400, height: 300 });
		expect(filledArea(content)).toBeCloseTo(400 * 300, 3);
		expect((window as { svgRan?: boolean }).svgRan).toBeUndefined();
	});

	it("refuses a file that isn't SVG", () => {
		expect(() => extractSvg("<html>not svg")).toThrow(MessageError);
	});
});
