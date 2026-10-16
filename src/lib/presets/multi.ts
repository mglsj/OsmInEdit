/**
 * The tags of several selected features as one editor shows them (iD's combined tags): the
 * values they share, and for the others each feature's own value, so a field can say "Multiple
 * values" and a list field can change each feature's list rather than overwrite it.
 */
import type { Tags } from "#lib/osm/tags.ts";
import { splitSemicolons } from "./combo.ts";

export interface CombinedTags {
	/** The tags every feature has, with the same value. */
	readonly tags: Tags;
	/**
	 * The keys whose values differ, or that only some features have: each feature's value, in
	 * order (undefined for a feature without the key).
	 */
	readonly mixed: ReadonlyMap<string, readonly (string | undefined)[]>;
}

export function combineTags(tagsList: readonly Tags[]): CombinedTags {
	const keys = new Set(tagsList.flatMap((tags) => Object.keys(tags)));
	const tags: Record<string, string> = {};
	const mixed = new Map<string, (string | undefined)[]>();
	for (const key of keys) {
		const values = tagsList.map((t) => t[key]);
		const [first] = values;
		if (first !== undefined && values.every((v) => v === first)) {
			tags[key] = first;
		} else {
			mixed.set(key, values);
		}
	}
	return { tags, mixed };
}

/** Whether the features have different values for `key`. */
export function isMixed(combined: CombinedTags, key: string): boolean {
	return combined.mixed.has(key);
}

export interface Chip {
	readonly value: string;
	/** Every feature's list has it (otherwise only some do). */
	readonly all: boolean;
}

/** The values of a `;` list field over the features, in the order first found. */
export function chipsIn(combined: CombinedTags, key: string): Chip[] {
	const values = combined.mixed.get(key) ?? [combined.tags[key]];
	const lists = values.map((value) => splitSemicolons(value));
	const seen = [...new Set(lists.flat())];
	return seen.map((value) => ({
		value,
		all: lists.every((list) => list.includes(value)),
	}));
}
