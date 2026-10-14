import { describe, expect, it } from "vitest";
import { corners, type LngLat, place } from "./georef.ts";
import {
	exportPlans,
	type PlanFileEntry,
	PlanFileError,
	parsePlansFile,
	transformOf,
} from "./plan-file.ts";

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** Corners of a 1.x plan, clockwise from the top left, as [lon, lat]. */
const LEGACY_CORNERS: [LngLat, LngLat, LngLat, LngLat] = [
	[-1.6955, 48.137],
	[-1.6949, 48.1369],
	[-1.695, 48.1366],
	[-1.6956, 48.1367],
];

/** A 1.x export entry, with corners written the way Leaflet serialised them. */
function legacyEntry(write: (c: LngLat) => unknown): Record<string, unknown> {
	const [tl, tr, br, bl] = LEGACY_CORNERS;
	return {
		id: "abc",
		label: "Ground floor.png",
		image: IMAGE,
		topleft: write(tl),
		topright: write(tr),
		bottomright: write(br),
		bottomleft: write(bl),
		level: 0,
		opacity: 0.8,
		visible: true,
		selected: true,
	};
}

function expectCorners(
	actual: readonly LngLat[],
	expected: readonly LngLat[],
): void {
	actual.forEach(([lon, lat], i) => {
		expect(lon).toBeCloseTo(expected[i]?.[0] ?? Number.NaN, 9);
		expect(lat).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 9);
	});
}

describe("IndoorID plan files", () => {
	it("read back what was exported", () => {
		const transform = place(
			{ center: [-1.6953, 48.1368], metresPerPixel: 0.05, bearing: 12 },
			400,
			300,
		);
		const plan: PlanFileEntry = {
			name: "Ground floor",
			image: IMAGE,
			width: 400,
			height: 300,
			level: "0.5",
			opacity: 0.4,
			visible: false,
			placement: { transform },
			controlPoints: [{ image: [10, 20], map: [-1.6954, 48.1369] }],
		};

		const [read, ...rest] = parsePlansFile(exportPlans([plan]));

		expect(rest).toEqual([]);
		expect(read).toMatchObject({
			name: "Ground floor",
			image: IMAGE,
			width: 400,
			height: 300,
			level: "0.5",
			opacity: 0.4,
			visible: false,
			controlPoints: plan.controlPoints,
		});
		expectCorners(
			corners(transformOf(read as PlanFileEntry, 400, 300), 400, 300),
			corners(transform, 400, 300),
		);
	});
});

describe("1.x plan files", () => {
	it.each([
		["[lat, lng] arrays", ([lon, lat]: LngLat) => [lat, lon]],
		["{lat, lng} objects", ([lon, lat]: LngLat) => ({ lat, lng: lon })],
	])("keep the plan's four corners exactly, from %s", (_, write) => {
		const text = JSON.stringify([legacyEntry(write)]);
		const [plan] = parsePlansFile(text);
		if (!plan) throw new Error("No plan");

		// The image size is only known once decoded; any size gives the same corners.
		expectCorners(
			corners(transformOf(plan, 800, 600), 800, 600),
			LEGACY_CORNERS,
		);
		expect(plan).toMatchObject({
			name: "Ground floor.png",
			image: IMAGE,
			level: "0",
			opacity: 0.8,
			visible: true,
		});
	});

	it("fill in what older exports left out", () => {
		const entry = legacyEntry(([lon, lat]) => [lat, lon]);
		delete entry.bottomright;
		delete entry.opacity;
		entry.level = null;
		const [plan] = parsePlansFile(JSON.stringify([entry]));
		if (!plan) throw new Error("No plan");

		// 1.x drew a missing bottom-right corner below the top right, right of the bottom left.
		const [tl, tr, , bl] = LEGACY_CORNERS;
		expectCorners(corners(transformOf(plan, 400, 300), 400, 300), [
			tl,
			tr,
			[tr[0], bl[1]],
			bl,
		]);
		expect(plan.opacity).toBe(1);
		expect(plan.level).toBeNull();
	});
});

describe("other files", () => {
	it.each([
		["not JSON", "<svg/>"],
		["JSON of something else", '{"type": "FeatureCollection"}'],
		["a plan without an image", JSON.stringify([{ id: "a", label: "x" }])],
	])("are refused with a message: %s", (_, text) => {
		expect(() => parsePlansFile(text)).toThrow(PlanFileError);
	});
});
