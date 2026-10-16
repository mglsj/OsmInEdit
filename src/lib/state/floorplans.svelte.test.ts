import { describe, expect, it } from "vitest";
import { PLAN_COLORS } from "#lib/floorplans/colors.ts";
import { place, translateTo } from "#lib/floorplans/georef.ts";
import type { PlanImage } from "#lib/floorplans/import.ts";
import { offset, RENNES } from "#lib/floorplans/test-geometry.ts";
import { msg } from "#lib/i18n/messages.ts";
import type {
	PlanStore,
	StoredBuildings,
	StoredPlan,
} from "#lib/persist/plan-store.ts";
import { type FloorPlan, FloorPlans } from "./floorplans.svelte.ts";

const image: PlanImage = {
	width: 400,
	height: 300,
	blob: new Blob(),
	levels: [],
};

/**
 * A 400 × 300 px plan added in a 25 m tall view centred on RENNES: north up, 15 m tall, so 5 cm
 * per pixel, its top-left pixel 10 m west and 7.5 m north of RENNES.
 */
function withPlan() {
	const floorplans = new FloorPlans();
	floorplans.add(image, "plan", { center: RENNES, heightMetres: 25 }, "0");
	return floorplans;
}

describe("FloorPlans.click", () => {
	it("explains a click off the plan, for each tool", () => {
		const floorplans = withPlan();
		const offPlan = offset(RENNES, 500, 500);
		floorplans.setTool("points");
		expect(floorplans.click(offPlan)).toEqual(
			msg("plan_tool_click_plan_first"),
		);
		floorplans.setTool("measure");
		expect(floorplans.click(offPlan)).toEqual(msg("plan_tool_measure_on_plan"));
		floorplans.setTool("rotate");
		expect(floorplans.click(offPlan)).toEqual(msg("plan_tool_pivot_on_plan"));
	});
});

describe("FloorPlans.clearPoints", () => {
	it("removes every control point, leaving the plan where they put it", () => {
		const floorplans = withPlan();
		floorplans.setTool("points");
		// Pixel (20, 20) to 2 m further west, which moves the plan; then pixel (380, 280), now
		// at 7 m east, 6.5 m south, stays there.
		floorplans.click(offset(RENNES, -9, 6.5));
		floorplans.click(offset(RENNES, -11, 6.5));
		floorplans.click(offset(RENNES, 7, -6.5));
		floorplans.click(offset(RENNES, 7, -6.5));
		const placed = floorplans.editing?.transform;
		expect(floorplans.editing?.controlPoints).toHaveLength(2);

		floorplans.clearPoints();

		expect(floorplans.editing?.controlPoints).toEqual([]);
		expect(floorplans.editing?.transform).toEqual(placed);
		expect(floorplans.tool).toEqual({ kind: "points", pending: null });
	});

	it("drops a half-done pick: a pending control point, measured spots, the rotation pin", () => {
		const floorplans = withPlan();
		const onPlan = offset(RENNES, 0, 0);
		const placed = floorplans.editing?.transform;

		floorplans.setTool("points");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "points", pending: null });

		floorplans.setTool("measure");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "measure", points: [] });

		floorplans.setTool("rotate");
		floorplans.click(onPlan);
		floorplans.clearPoints();
		expect(floorplans.tool).toEqual({ kind: "rotate", pin: null });
		expect(floorplans.editing?.transform).toBe(placed);
	});
});

describe("plan colours", () => {
	it("gives each new plan a colour no other plan has", () => {
		const floorplans = new FloorPlans();
		const view = { center: RENNES, heightMetres: 25 };
		for (let i = 0; i < PLAN_COLORS.length; i++) {
			floorplans.add(image, `plan ${i}`, view, "0");
		}
		const colors = floorplans.plans.map((p) => p.color);
		expect(new Set(colors).size).toBe(PLAN_COLORS.length);
		for (const c of colors) {
			expect(PLAN_COLORS.map((p) => p.value)).toContain(c);
		}
	});

	it("keeps the colour a plan file gives, and gives one to plans without", () => {
		const floorplans = new FloorPlans();
		const fields = {
			name: "plan",
			image,
			transform: place(
				{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
				400,
				300,
			),
			controlPoints: [],
			fitKind: "similarity" as const,
			opacity: 0.5,
			level: "0",
			visible: true,
		};
		floorplans.insert({ ...fields, color: "#16a34a" });
		floorplans.insert(fields);
		const [kept, given] = floorplans.plans;
		expect(kept?.color).toBe("#16a34a");
		expect(given?.color).not.toBe("#16a34a");
		expect(PLAN_COLORS.map((p) => p.value)).toContain(given?.color);
	});

	it("gives plans saved before colours existed one when they come back", async () => {
		const stored = {
			id: "old",
			name: "old plan",
			transform: place(
				{ center: RENNES, metresPerPixel: 0.05, bearing: 0 },
				400,
				300,
			),
			controlPoints: [],
			fitKind: "similarity" as const,
			opacity: 0.5,
			level: "0",
			visible: true,
			order: 0,
		};
		const floorplans = new FloorPlans({
			store: {
				load: async () => [{ plan: stored, image: new Blob() }],
				saveImage: async () => {},
				save: async () => {},
				delete: async () => {},
				loadBuildings: async () => undefined,
				saveBuildings: async () => {},
				saveStack: async () => {},
			},
			decode: async () => image,
		});
		await floorplans.restore();
		expect(PLAN_COLORS.map((p) => p.value)).toContain(
			floorplans.plans[0]?.color,
		);
	});

	it("changes a plan's colour", () => {
		const floorplans = withPlan();
		const id = floorplans.editingId ?? "";
		floorplans.update(id, { color: "#78350f" });
		expect(floorplans.editing?.color).toBe("#78350f");
	});
});

/** A store keeping what was saved, in order. */
function memoryStore() {
	const saved: StoredPlan[] = [];
	const store: PlanStore = {
		load: async () => [],
		saveImage: async () => {},
		save: async (plan) => {
			saved.push(plan);
		},
		delete: async () => {},
		loadBuildings: async () => undefined,
		saveBuildings: async () => {},
		saveStack: async () => {},
	};
	return { store, saved };
}

const view = { center: RENNES, heightMetres: 25 };

/** Two plans, `a` then `b`, neither in Edit, and the store they were saved in. */
function twoPlans() {
	const { store, saved } = memoryStore();
	const floorplans = new FloorPlans({ store });
	floorplans.add(image, "a", view, "0");
	floorplans.add(image, "b", view, "0");
	floorplans.done();
	const [a, b] = floorplans.plans;
	if (!a || !b) throw new Error("No plans");
	saved.length = 0;
	return { floorplans, saved, a, b };
}

/** The plan's transform moved so its top-left pixel is 20 m west, 10 m north of RENNES. */
function moved(plan: FloorPlan) {
	return translateTo(plan.transform, [0, 0], offset(RENNES, -20, 10));
}

/** Moves the plan in Edit 2 m west by a control point on its pixel (20, 20). */
function moveWest(floorplans: FloorPlans) {
	floorplans.setTool("points");
	floorplans.click(offset(RENNES, -9, 6.5));
	floorplans.click(offset(RENNES, -11, 6.5));
	floorplans.setTool(null);
}

describe("editing a plan", () => {
	it("opens a new plan in Edit, saved as imported", () => {
		const { store, saved } = memoryStore();
		const floorplans = new FloorPlans({ store });
		floorplans.add(image, "plan", view, "0");
		const [plan] = floorplans.plans;
		expect(floorplans.editingId).toBe(plan?.id);
		expect(floorplans.dirty).toBe(false);
		expect(saved.map((p) => p.id)).toEqual([plan?.id]);
	});

	it("keeps changes out of storage until Done, then saves them once", () => {
		const { floorplans, saved, a } = twoPlans();
		floorplans.edit(a.id);
		moveWest(floorplans);
		floorplans.update(a.id, { opacity: 0.8, level: "1", color: "#78350f" });
		floorplans.preview(a.id, moved(a));
		floorplans.commitPlacement(a.id);
		expect(floorplans.dirty).toBe(true);
		expect(saved).toEqual([]);

		floorplans.done();

		expect(floorplans.editingId).toBeNull();
		expect(floorplans.dirty).toBe(false);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatchObject({
			id: a.id,
			opacity: 0.8,
			level: "1",
			color: "#78350f",
			transform: floorplans.plans[0]?.transform,
		});
	});

	it("puts the plan back as it was when Edit was pressed on Cancel", () => {
		const { floorplans, saved, a } = twoPlans();
		floorplans.edit(a.id);
		moveWest(floorplans);
		floorplans.update(a.id, { opacity: 0.8, name: "renamed" });

		floorplans.cancel();

		expect(floorplans.plans[0]).toBe(a);
		expect(floorplans.editingId).toBeNull();
		expect(floorplans.tool).toBeNull();
		expect(saved).toEqual([]);
	});

	it("edits one plan at a time", () => {
		const { floorplans, a, b } = twoPlans();
		floorplans.edit(a.id);
		floorplans.update(a.id, { opacity: 0.9 });

		// Callers ask first (whenSaved): editing another plan drops unsaved changes.
		floorplans.edit(b.id);

		expect(floorplans.editingId).toBe(b.id);
		expect(floorplans.plans[0]).toBe(a);
	});

	it("leaves locked plans alone", () => {
		const { floorplans, saved, a } = twoPlans();
		floorplans.update(a.id, { opacity: 0.9 });
		floorplans.preview(a.id, moved(a));
		floorplans.commitPlacement(a.id);
		floorplans.setTool("points");

		expect(floorplans.plans[0]).toBe(a);
		expect(floorplans.tool).toBeNull();
		expect(floorplans.click(offset(RENNES, 0, 0))).toBeNull();
		expect(saved).toEqual([]);
	});

	it("shows and hides plans at once, even in Edit, and Cancel keeps that", () => {
		const { floorplans, saved, a, b } = twoPlans();
		floorplans.setVisible(b.id, false);
		expect(saved).toEqual([
			expect.objectContaining({ id: b.id, visible: false }),
		]);

		floorplans.edit(a.id);
		floorplans.update(a.id, { opacity: 0.9 });
		floorplans.setVisible(a.id, false);
		// Saved hidden, without the change still in Edit.
		expect(saved[1]).toMatchObject({ id: a.id, visible: false, opacity: 0.5 });

		floorplans.cancel();
		expect(floorplans.plans[0]).toMatchObject({ visible: false, opacity: 0.5 });
	});

	it("ends the session when the plan in Edit is removed", () => {
		const { floorplans, a } = twoPlans();
		floorplans.edit(a.id);
		floorplans.remove(a.id);
		expect(floorplans.editingId).toBeNull();
		expect(floorplans.dirty).toBe(false);
	});
});

describe("whenSaved", () => {
	it("goes ahead at once without unsaved changes", () => {
		const { floorplans, a } = twoPlans();
		floorplans.edit(a.id);
		let ran = 0;
		floorplans.whenSaved(() => ran++);
		expect(ran).toBe(1);
		expect(floorplans.confirming).toBe(false);
	});

	it("asks first when the plan in Edit has unsaved changes", () => {
		const { floorplans, saved, a } = twoPlans();
		let ran = 0;

		floorplans.edit(a.id);
		floorplans.update(a.id, { opacity: 0.9 });
		floorplans.whenSaved(() => ran++);
		expect(floorplans.confirming).toBe(true);
		expect(ran).toBe(0);

		// Keep editing: nothing happens.
		floorplans.resolve("keep");
		expect(floorplans.confirming).toBe(false);
		expect(ran).toBe(0);
		expect(floorplans.editingId).toBe(a.id);

		// Save: the changes are saved, then it goes ahead.
		floorplans.whenSaved(() => ran++);
		floorplans.resolve("save");
		expect(ran).toBe(1);
		expect(saved.at(-1)).toMatchObject({ id: a.id, opacity: 0.9 });
		expect(floorplans.editingId).toBeNull();

		// Discard: the plan goes back, then it goes ahead.
		floorplans.edit(a.id);
		const before = floorplans.plans[0];
		floorplans.update(a.id, { opacity: 0.2 });
		floorplans.whenSaved(() => ran++);
		floorplans.resolve("discard");
		expect(ran).toBe(2);
		expect(floorplans.plans[0]).toBe(before);
		expect(floorplans.editingId).toBeNull();
	});
});

/** A store keeping the latest of each record, like IndexedDB, to restore from. */
function lastingStore() {
	const plans = new Map<string, StoredPlan>();
	let buildings: StoredBuildings | undefined;
	const store: PlanStore = {
		load: async () =>
			[...plans.values()]
				.sort((a, b) => a.order - b.order)
				.map((plan) => ({ plan, image: new Blob() })),
		saveImage: async () => {},
		save: async (plan) => {
			plans.set(plan.id, plan);
		},
		delete: async (id) => {
			plans.delete(id);
		},
		loadBuildings: async () => buildings,
		saveBuildings: async (b) => {
			buildings = b;
		},
		saveStack: async (stack, b) => {
			for (const plan of stack) plans.set(plan.id, plan);
			buildings = b;
		},
	};
	return { store, plans };
}

/** The layer stack, bottom to top, by plan name. */
function stack(floorplans: FloorPlans): string[] {
	return floorplans.layers.map((l) =>
		l.kind === "plan" ? l.plan.name : "buildings",
	);
}

function idOf(floorplans: FloorPlans, name: string): string {
	const plan = floorplans.plans.find((p) => p.name === name);
	if (!plan) throw new Error(`No plan ${name}`);
	return plan.id;
}

/** Lets the store's promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("layer stack", () => {
	it("starts with the buildings on top, and adds plans above the other plans", () => {
		const floorplans = new FloorPlans();
		expect(stack(floorplans)).toEqual(["buildings"]);
		floorplans.add(image, "a", view, "0");
		floorplans.add(image, "b", view, "0");
		expect(stack(floorplans)).toEqual(["a", "b", "buildings"]);

		floorplans.move("buildings", 0);
		floorplans.add(image, "c", view, "0");
		expect(stack(floorplans)).toEqual(["buildings", "a", "b", "c"]);
	});

	it("moves a plan or the buildings to a place in the stack", () => {
		const floorplans = new FloorPlans();
		for (const name of ["a", "b", "c"]) floorplans.add(image, name, view, "0");

		floorplans.move(idOf(floorplans, "c"), 0);
		expect(stack(floorplans)).toEqual(["c", "a", "b", "buildings"]);
		floorplans.move("buildings", 1);
		expect(stack(floorplans)).toEqual(["c", "buildings", "a", "b"]);
		floorplans.move(idOf(floorplans, "c"), 3);
		expect(stack(floorplans)).toEqual(["buildings", "a", "b", "c"]);
		// Out of range: to the nearest end.
		floorplans.move("buildings", 9);
		expect(stack(floorplans)).toEqual(["a", "b", "c", "buildings"]);
	});

	it("keeps the buildings in place among the plans left when one is removed", () => {
		const floorplans = new FloorPlans();
		for (const name of ["a", "b"]) floorplans.add(image, name, view, "0");
		floorplans.move("buildings", 1);
		expect(stack(floorplans)).toEqual(["a", "buildings", "b"]);

		floorplans.remove(idOf(floorplans, "a"));
		expect(stack(floorplans)).toEqual(["buildings", "b"]);
	});

	it("brings back the stack, and hidden buildings, after a reload", async () => {
		const { store } = lastingStore();
		const before = new FloorPlans({ store, decode: async () => image });
		for (const name of ["a", "b", "c"]) before.add(image, name, view, "0");
		before.done();
		before.move("buildings", 1);
		before.move(idOf(before, "c"), 0);
		before.setBuildingsVisible(false);
		expect(stack(before)).toEqual(["c", "a", "buildings", "b"]);
		await settled();

		const after = new FloorPlans({ store, decode: async () => image });
		await after.restore();

		expect(stack(after)).toEqual(["c", "a", "buildings", "b"]);
		expect(after.buildings.visible).toBe(false);
	});

	it("puts the buildings on top of plans saved before they were in the list", async () => {
		const { store } = lastingStore();
		const before = new FloorPlans({ store, decode: async () => image });
		for (const name of ["a", "b"]) before.add(image, name, view, "0");
		await settled();
		// No buildings record: as saved before P4.1.
		const after = new FloorPlans({
			store: { ...store, loadBuildings: async () => undefined },
			decode: async () => image,
		});
		await after.restore();

		expect(stack(after)).toEqual(["a", "b", "buildings"]);
		expect(after.buildings.visible).toBe(true);
	});

	it("saves a plan in Edit at its new place without its unsaved changes", async () => {
		const { store, plans } = lastingStore();
		const floorplans = new FloorPlans({ store });
		for (const name of ["a", "b"]) floorplans.add(image, name, view, "0");
		floorplans.edit(idOf(floorplans, "a"));
		floorplans.update(idOf(floorplans, "a"), { opacity: 0.9 });

		floorplans.move(idOf(floorplans, "a"), 2);
		await settled();

		const a = plans.get(idOf(floorplans, "a"));
		const b = plans.get(idOf(floorplans, "b"));
		expect(a?.opacity).toBe(0.5);
		expect((a?.order ?? 0) > (b?.order ?? 0)).toBe(true);
		// Still in Edit, with its changes.
		expect(floorplans.editing?.opacity).toBe(0.9);
	});
});
