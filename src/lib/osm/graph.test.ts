import { describe, expect, it } from "vitest";
import type { Entity } from "./entity.ts";
import { node, relation, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";

function fixture() {
	return Graph.fromEntities([
		node("n1"),
		node("n2"),
		node("n3"),
		way("w1", ["n1", "n2"]),
		way("w2", ["n2", "n3"]),
		relation("r1", [{ ref: "w1", role: "outer" }]),
	]);
}

describe("Graph", () => {
	it("looks entities up by id", () => {
		const graph = fixture();
		expect(graph.entity("n1")?.type).toBe("node");
		expect(graph.entity("w9")).toBeUndefined();
	});

	it("lists the ways and relations an entity belongs to", () => {
		const graph = fixture();
		expect(
			graph
				.parentWays("n2")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w1", "w2"]);
		expect(graph.parentWays("n1").map((w) => w.id)).toEqual(["w1"]);
		expect(graph.parentRelations("w1").map((r) => r.id)).toEqual(["r1"]);
		expect(graph.parentRelations("w2")).toEqual([]);
	});

	it("returns a new graph on change and leaves the old one untouched", () => {
		const before = fixture();
		const after = before
			.replace({ ...node("n1"), tags: { amenity: "bench" } })
			.remove("w2");

		expect(after.entity("n1")?.tags).toEqual({ amenity: "bench" });
		expect(after.entity("w2")).toBeUndefined();
		expect(before.entity("n1")?.tags).toEqual({});
		expect(before.entity("w2")).toBeDefined();
	});

	it("keeps parent lists up to date after local changes", () => {
		const graph = fixture()
			.replace(way("w2", ["n3"]))
			.replace(way("w-1", ["n1", "n3"]))
			.replace(relation("r1", [{ ref: "w-1", role: "outer" }]));

		expect(graph.parentWays("n2").map((w) => w.id)).toEqual(["w1"]);
		expect(
			graph
				.parentWays("n3")
				.map((w) => w.id)
				.sort(),
		).toEqual(["w-1", "w2"]);
		expect(graph.parentRelations("w1")).toEqual([]);
		expect(graph.parentRelations("w-1").map((r) => r.id)).toEqual(["r1"]);
	});

	it("doesn't list removed parents", () => {
		const graph = fixture().remove("w1");
		expect(graph.parentWays("n1")).toEqual([]);
	});

	it("gives new entities unused negative ids", () => {
		let graph = fixture();
		const first = graph.newId("node");
		expect(first).toBe("n-1");

		graph = graph.replace(node(first));
		const second = graph.newId("way");
		expect(second).toBe("w-2");

		// Ids are not reused after the entity is removed.
		expect(graph.remove(first).newId("node")).toBe("n-2");
	});
});

describe("Graph.changedSince", () => {
	const base = Graph.fromEntities([node("n1"), node("n2"), node("n3")]);

	it("lists the entities added, changed or removed since another graph", () => {
		const after = base
			.replace(node("n1", { door: "yes" }))
			.remove("n2")
			.replace(node("n-1"));
		expect([...after.changedSince(base)].sort()).toEqual(["n-1", "n1", "n2"]);
		expect([...base.changedSince(after)].sort()).toEqual(["n-1", "n1", "n2"]);
	});

	it("leaves out entities put back as they were (the same object)", () => {
		const edited = base.replace(node("n1", { door: "yes" }));
		const back = edited.replace(base.entity("n1") as Entity);
		expect([...back.changedSince(base)]).toEqual([]);
		expect([...base.changedSince(base)]).toEqual([]);
	});

	it("compares the server data too, when more was downloaded", () => {
		const edited = base.replace(node("n1", { door: "yes" }));
		// Local edits kept on the new server data, as History.merge does.
		const loaded = edited.rebaseOnto(
			edited.withBaseEntities([node("n4"), { ...node("n3"), version: 2 }]),
		);
		expect([...loaded.changedSince(edited)].sort()).toEqual(["n3", "n4"]);
	});
});
