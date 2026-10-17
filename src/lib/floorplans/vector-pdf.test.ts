import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { extractPdfPage, type OperatorList } from "./vector-pdf.ts";

/** A US-letter-landscape-like page, 300 × 200 pt: PDF y runs up, plan units down. */
const page = { width: 300, height: 200, transform: [1, 0, 0, -1, 0, 200] };

/** pdf.js path codes. */
const M = 0;
const L = 1;
const C = 2;
const Z = 4;

/** An operator list, from `[op, ...args]` entries. */
function ops(...entries: [number, ...unknown[]][]): OperatorList {
	return {
		fnArray: entries.map(([fn]) => fn),
		argsArray: entries.map(([, ...args]) => args),
	};
}

/** A path painted by `paint` (pdf.js's constructPath). */
const path = (paint: number, ...data: number[]): [number, ...unknown[]] => [
	OPS.constructPath,
	paint,
	[new Float32Array(data)],
	null,
];

const extract = (
	list: OperatorList,
	groups?: Parameters<typeof extractPdfPage>[2]["groups"],
) => extractPdfPage(list, page, { OPS, ...(groups ? { groups } : {}) });

/** Segments as [[x0, y0, x1, y1], …]. */
function segments(content: ReturnType<typeof extractPdfPage>): number[][] {
	return Array.from({ length: content.segments.length / 4 }, (_, i) => [
		...content.segments.subarray(i * 4, i * 4 + 4),
	]);
}

/** Total area of the filled triangles. */
function filledArea(content: ReturnType<typeof extractPdfPage>): number {
	const t = content.triangles;
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

describe("extractPdfPage: a PDF page's paths in plan units", () => {
	it("places strokes through the page's viewport, measured in points from the top left", () => {
		const content = extract(
			ops(path(OPS.stroke, M, 0, 0, L, 100, 0, L, 100, 50)),
		);
		expect(content.size).toEqual({ width: 300, height: 200 });
		expect(segments(content)).toEqual([
			[0, 200, 100, 200],
			[100, 200, 100, 150],
		]);
	});

	it("follows the transform through save and restore, and form XObjects", () => {
		const content = extract(
			ops(
				[OPS.save],
				[OPS.transform, 2, 0, 0, 2, 10, 0],
				path(OPS.stroke, M, 0, 0, L, 10, 0),
				[OPS.restore],
				path(OPS.stroke, M, 0, 0, L, 10, 0),
				[OPS.paintFormXObjectBegin, [1, 0, 0, 1, 0, 100], [0, 0, 50, 50]],
				path(OPS.stroke, M, 0, 0, L, 10, 0),
				[OPS.paintFormXObjectEnd],
				path(OPS.stroke, M, 0, 10, L, 10, 10),
			),
		);
		expect(segments(content)).toEqual([
			[10, 200, 30, 200],
			[0, 200, 10, 200],
			[0, 100, 10, 100],
			[0, 190, 10, 190],
		]);
	});

	it("closes a path back to its start", () => {
		const content = extract(
			ops(path(OPS.closeStroke, M, 0, 0, L, 10, 0, L, 10, 10, Z)),
		);
		expect(segments(content)).toContainEqual([10, 190, 0, 200]);
	});

	it("keeps each stroke's colour, opacity and width in points, shared by paths alike", () => {
		const content = extract(
			ops(
				[OPS.setStrokeRGBColor, "#00ff00"],
				[OPS.setGState, [["CA", 0.5]]],
				[OPS.save],
				[OPS.transform, 3, 0, 0, 3, 0, 0],
				[OPS.setLineWidth, 2],
				path(OPS.stroke, M, 0, 0, L, 1, 0),
				[OPS.restore],
				[OPS.setLineWidth, 0],
				path(OPS.stroke, M, 0, 0, L, 1, 0),
				path(OPS.stroke, M, 0, 5, L, 1, 5),
			),
		);
		expect(content.styles).toEqual([
			{ color: [0, 255, 0, 128], width: 6, layer: -1 },
			// Width 0: a hairline, one device pixel at any zoom.
			{ color: [0, 255, 0, 128], width: 0, layer: -1 },
		]);
		expect([...content.segmentStyles]).toEqual([0, 1, 1]);
	});

	it("flattens curves to within 0.1 pt", () => {
		// A quarter circle of radius 100 pt, as a cubic Bézier.
		const k = 55.228;
		const content = extract(
			ops(path(OPS.stroke, M, 100, 0, C, 100, k, k, 100, 0, 100)),
		);
		const bezier = (t: number) => {
			const u = 1 - t;
			return [
				3 * u * u * t * 100 + 3 * u * t * t * k,
				200 - (3 * u * u * t * k + 3 * u * t * t * 100 + t * t * t * 100),
			].map((v, i) => (i === 0 ? u * u * u * 100 + v : v)) as [number, number];
		};
		const curve = Array.from({ length: 20001 }, (_, i) => bezier(i / 20000));
		const nearest = ([x, y]: number[]) =>
			Math.min(
				...curve.map(([cx, cy]) => Math.hypot(cx - (x ?? 0), cy - (y ?? 0))),
			);
		const lines = segments(content);
		expect(lines.length).toBeGreaterThan(4);
		expect(lines.length).toBeLessThan(100);
		for (const [x0, y0, x1, y1] of lines) {
			expect(nearest([x0 ?? 0, y0 ?? 0])).toBeLessThan(0.01);
			// The chord's middle strays furthest from the curve.
			expect(
				nearest([((x0 ?? 0) + (x1 ?? 0)) / 2, ((y0 ?? 0) + (y1 ?? 0)) / 2]),
			).toBeLessThan(0.1);
		}
	});

	it("fills paths as triangles, holes left open, separate shapes all filled", () => {
		const square = (x: number, y: number, s: number) => [
			M,
			x,
			y,
			L,
			x + s,
			y,
			L,
			x + s,
			y + s,
			L,
			x,
			y + s,
			Z,
		];
		const holed = extract(
			ops(
				[OPS.setFillRGBColor, "#ff0000"],
				path(OPS.eoFill, ...square(0, 0, 10), ...square(3, 3, 4)),
			),
		);
		expect(filledArea(holed)).toBeCloseTo(100 - 16, 6);
		expect(holed.styles).toEqual([
			{ color: [255, 0, 0, 255], width: 0, layer: -1 },
		]);
		expect(holed.segments).toHaveLength(0);

		const two = extract(
			ops(path(OPS.fill, ...square(0, 0, 10), ...square(20, 0, 10))),
		);
		expect(filledArea(two)).toBeCloseTo(200, 6);

		const both = extract(ops(path(OPS.fillStroke, ...square(0, 0, 10))));
		expect(filledArea(both)).toBeCloseTo(100, 6);
		expect(segments(both)).toHaveLength(4);
	});

	it("skips clipping paths and transparent paint", () => {
		const content = extract(
			ops(
				path(OPS.endPath, M, 0, 0, L, 10, 0),
				[OPS.clip],
				[OPS.setStrokeTransparent],
				path(OPS.stroke, M, 0, 0, L, 10, 0),
				[OPS.setFillTransparent],
				path(OPS.fill, M, 0, 0, L, 10, 0, L, 10, 10, Z),
			),
		);
		expect(content.segments).toHaveLength(0);
		expect(content.triangles).toHaveLength(0);
	});

	it("tags paths with their CAD layer, listing the layers used in the PDF's order", () => {
		const groups = new Map([
			["7R", { name: "Walls", visible: true }],
			["8R", { name: "Unused", visible: true }],
			["9R", { name: "Furniture", visible: false }],
		]);
		const content = extract(
			ops(
				[OPS.beginMarkedContentProps, "OC", { type: "OCG", id: "9R" }],
				path(OPS.stroke, M, 0, 0, L, 1, 0),
				[OPS.endMarkedContent],
				[OPS.beginMarkedContentProps, "OC", { type: "OCG", id: "7R" }],
				[OPS.beginMarkedContent, "Span"],
				path(OPS.stroke, M, 0, 0, L, 1, 0),
				[OPS.endMarkedContent],
				[OPS.endMarkedContent],
				path(OPS.stroke, M, 0, 0, L, 1, 0),
			),
			groups,
		);
		expect(content.layers).toEqual([
			{ id: "7R", name: "Walls", visible: true },
			{ id: "9R", name: "Furniture", visible: false },
		]);
		expect(content.styles.map((s) => s.layer)).toEqual([1, 0, -1]);
	});
});

describe("extractPdfPage on a PDF read by pdf.js", () => {
	it("gives the test plan's first page: a red rectangle over its 4 × 3 inches", async () => {
		const data = new Uint8Array(readFileSync("tests/e2e/files/plan.pdf"));
		const task = getDocument({ data });
		const pdf = await task.promise;
		const first = await pdf.getPage(1);
		const viewport = first.getViewport({ scale: 1 });
		const content = extractPdfPage(await first.getOperatorList(), viewport, {
			OPS,
		});
		expect(content.size).toEqual({ width: 288, height: 216 });
		expect(filledArea(content)).toBeCloseTo(288 * 216, 3);
		expect(content.styles).toEqual([
			{ color: [255, 0, 0, 255], width: 0, layer: -1 },
		]);
		await task.destroy();
	});
});
