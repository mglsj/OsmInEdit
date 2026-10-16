import { describe, expect, it } from "vitest";
import type { MessageError } from "#lib/i18n/messages.ts";
import { fakeImage } from "#lib/state/testing/plan-store.ts";
import { rasterContent } from "./content.ts";
import { corners, place } from "./georef.ts";
import type { PdfDocument, PlanDecoders } from "./import.ts";
import { exportPlans, parsePlanFile } from "./plan-file.ts";
import {
	type ExportedPlan,
	openPlanFile,
	pageName,
	readPlanFile,
	writePlanFile,
} from "./plan-io.ts";
import { RENNES } from "./test-geometry.ts";

const pdf: PdfDocument = {
	pageCount: 2,
	pageSize: async () => ({ width: 8.27, height: 11.69 }),
	thumbnail: async () => "",
	render: async () => rasterContent(fakeImage()),
	close: () => {},
};

/** Photos are 400 × 300 px; SVG drawings 800 × 600 user units, rendered at 400 × 300 px. */
const decoders: PlanDecoders = {
	raster: async (file) => rasterContent(fakeImage(file)),
	svg: async (file) =>
		rasterContent(fakeImage(file), { width: 800, height: 600 }),
	pdf: async () => pdf,
};

const file = (name: string, type: string, content = "x") =>
	new File([content], name, { type });

describe("openPlanFile: what a file picked for import gives", () => {
	it("decodes a photo, an SVG drawing, named after the file", async () => {
		const photo = await openPlanFile(
			file("Ground floor.png", "image/png"),
			decoders,
		);
		expect(photo).toMatchObject({ kind: "plan", name: "Ground floor" });
		expect(photo.kind === "plan" && photo.content.size).toEqual({
			width: 400,
			height: 300,
		});
		const drawing = await openPlanFile(
			file("first.svg", "image/svg+xml"),
			decoders,
		);
		expect(drawing.kind === "plan" && drawing.content.size).toEqual({
			width: 800,
			height: 600,
		});
	});

	it("opens a PDF for its pages to be picked", async () => {
		expect(
			await openPlanFile(file("Mall.pdf", "application/pdf"), decoders),
		).toEqual({ kind: "pdf", name: "Mall", document: pdf });
	});

	it("reads a plan file", async () => {
		const opened = await openPlanFile(
			file("plans.json", "application/json", exportPlans([])),
			decoders,
		);
		expect(opened).toEqual({ kind: "plans", plans: { plans: [] } });
	});

	it("refuses other files", async () => {
		const failure = await openPlanFile(
			file("notes.txt", "text/plain"),
			decoders,
		).catch((e: unknown) => e);
		expect((failure as MessageError).msg).toEqual({
			key: "plan_import_unsupported",
		});
	});
});

describe("pageName", () => {
	it("names a page after the file, with its number when there are several", () => {
		expect(pageName("Mall", 2, 3)).toBe("Mall, page 2");
		expect(pageName("Mall", 1, 1)).toBe("Mall");
	});
});

const transform = place(
	{ center: RENNES, metresPerPixel: 0.05, bearing: 30 },
	800,
	600,
);
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = `data:image/svg+xml;base64,${btoa("<svg/>")}`;

describe("readPlanFile: the plans of a plan file, each with its content", () => {
	it("measures each plan as the file says, its pixels a fraction of a unit", async () => {
		const text = exportPlans(
			[
				{
					name: "Drawing",
					image: SVG,
					width: 800,
					height: 600,
					level: "1",
					opacity: 0.3,
					visible: false,
					color: "#16a34a",
					placement: { transform },
					controlPoints: [{ image: [1, 2], map: RENNES }],
				},
			],
			{ below: 1, visible: false },
		);
		const { plans, buildings } = await readPlanFile(text, decoders);
		expect(buildings).toEqual({ below: 1, visible: false });
		const [plan] = plans;
		expect(plan).toMatchObject({
			name: "Drawing",
			size: { width: 800, height: 600 },
			transform,
			controlPoints: [{ image: [1, 2], map: RENNES }],
			fitKind: "similarity",
			opacity: 0.3,
			level: "1",
			visible: false,
			color: "#16a34a",
		});
		// Rendered at 400 px over 800 units: two units per pixel.
		expect(plan?.content.raster?.unit).toBe(2);
		expect(await plan?.content.raster?.image.blob.text()).toBe("<svg/>");
	});

	it("measures a 1.x plan by its image, placed by its four corners", async () => {
		const text = JSON.stringify([
			{
				label: "Old",
				image: PNG,
				topleft: [48.1, -1.7],
				topright: [48.1, -1.6],
				bottomright: [48.0, -1.6],
				bottomleft: [48.0, -1.7],
				level: -1,
				opacity: 1,
			},
		]);
		const [plan] = (await readPlanFile(text, decoders)).plans;
		expect(plan).toMatchObject({
			name: "Old",
			size: { width: 400, height: 300 },
			fitKind: "projective",
			level: "-1",
		});
		expect(plan?.content.raster?.unit).toBe(1);
		const [tl] = corners(plan?.transform ?? transform, 400, 300);
		expect(tl?.[0]).toBeCloseTo(-1.7, 9);
		expect(tl?.[1]).toBeCloseTo(48.1, 9);
	});
});

describe("writePlanFile: every plan, its file included", () => {
	const plan = (id: string, name: string): ExportedPlan => ({
		id,
		name,
		size: { width: 800, height: 600 },
		transform,
		controlPoints: [],
		opacity: 0.5,
		level: "0",
		visible: true,
		color: "#2563eb",
	});

	it("writes a file the plans are read back from", async () => {
		const originals = new Map([
			["a", new Blob(["<svg/>"], { type: "image/svg+xml" })],
		]);
		const text = await writePlanFile(
			[plan("b", "No file"), plan("a", "Drawing")],
			{ below: 1, visible: true },
			async (id) => originals.get(id),
		);
		const { plans, buildings } = parsePlanFile(text);
		// A plan whose file is gone (storage failed) is left out, from under the outlines too.
		expect(plans.map((p) => p.name)).toEqual(["Drawing"]);
		expect(plans[0]).toMatchObject({
			image: SVG,
			width: 800,
			height: 600,
			placement: { transform },
		});
		expect(buildings).toEqual({ below: 0, visible: true });
		const [read] = (await readPlanFile(text, decoders)).plans;
		expect(read?.content.size).toEqual({
			width: 800,
			height: 600,
		});
	});
});
