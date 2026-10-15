/**
 * Colours that tell floor plans apart on the map (their frames, handles and alignment marks)
 * and in the sidebar. They stay clear of the buildings' pink, and of each other.
 */

/** Colour of the building outlines in floor plan mode. */
export const BUILDING_COLOR = "#d6249f";

export interface PlanColor {
	readonly name: string;
	/** `#rrggbb`. */
	readonly value: string;
}

export const PLAN_COLORS: readonly PlanColor[] = [
	{ name: "Blue", value: "#2563eb" },
	{ name: "Orange", value: "#ea580c" },
	{ name: "Green", value: "#16a34a" },
	{ name: "Violet", value: "#7c3aed" },
	{ name: "Cyan", value: "#0891b2" },
	{ name: "Red", value: "#b91c1c" },
	{ name: "Ochre", value: "#a16207" },
	{ name: "Brown", value: "#78350f" },
];

/** A colour for a new plan: one no plan has yet, picked at random, or any once all are used. */
export function pickColor(
	used: readonly string[],
	random: () => number = Math.random,
): string {
	const all = PLAN_COLORS.map((c) => c.value);
	const free = all.filter((c) => !used.includes(c));
	const choices = free.length > 0 ? free : all;
	return choices[Math.floor(random() * choices.length)] ?? all[0] ?? "#2563eb";
}
