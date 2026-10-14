/**
 * Presets: named feature types ("Room", "Toilets") with their tags and fields, from iD's
 * tagging schema (see scripts/build-presets.ts) plus `overlay.json`.
 */
import type { Tags } from "#lib/osm/tags.ts";

/** Geometry as presets see it: a node on a way is a vertex. */
export type PresetGeometry = "point" | "vertex" | "line" | "area" | "relation";

export interface Preset {
	readonly id: string;
	readonly name: string;
	readonly terms: readonly string[];
	readonly icon?: string;
	readonly geometry: readonly PresetGeometry[];
	readonly tags: Tags;
	/** Tags set when choosing the preset (default: `tags`). */
	readonly addTags?: Tags;
	/** Tags removed when leaving the preset (default: `addTags`). */
	readonly removeTags?: Tags;
	readonly matchScore?: number;
	readonly searchable?: boolean;
	readonly fields: readonly string[];
	readonly moreFields: readonly string[];
}

export interface FieldOption {
	readonly value: string;
	readonly label: string;
}

export interface Field {
	readonly id: string;
	readonly key?: string;
	readonly keys?: readonly string[];
	readonly type: string;
	readonly label: string;
	readonly placeholder?: string;
	readonly options: readonly FieldOption[];
}

const FALLBACKS: Record<PresetGeometry, string> = {
	point: "point",
	vertex: "point",
	line: "line",
	area: "area",
	relation: "relation",
};

export class PresetIndex {
	readonly #presets: readonly Preset[];
	readonly #byId: ReadonlyMap<string, Preset>;
	readonly #fields: ReadonlyMap<string, Field>;

	constructor(presets: readonly Preset[], fields: readonly Field[]) {
		this.#presets = presets;
		this.#byId = new Map(presets.map((p) => [p.id, p]));
		this.#fields = new Map(fields.map((f) => [f.id, f]));
	}

	preset(id: string): Preset | undefined {
		return this.#byId.get(id);
	}

	field(id: string): Field | undefined {
		return this.#fields.get(id);
	}

	/** The fields of a preset, then its optional "more" fields, skipping unknown ones. */
	fieldsOf(preset: Preset): { fields: Field[]; moreFields: Field[] } {
		const resolve = (ids: readonly string[]) =>
			ids
				.map((id) => this.#fields.get(id))
				.filter((f): f is Field => f !== undefined);
		return {
			fields: resolve(preset.fields),
			moreFields: resolve(preset.moreFields),
		};
	}

	/** The best preset for these tags, or the generic one for the geometry. */
	match(tags: Tags, geometry: PresetGeometry): Preset {
		let best: Preset | undefined;
		let bestScore = 0;
		for (const preset of this.#presets) {
			if (!preset.geometry.includes(geometry)) continue;
			const score = matchScore(preset, tags);
			if (score > bestScore) {
				best = preset;
				bestScore = score;
			}
		}
		return best ?? this.#fallback(geometry);
	}

	/** Searchable presets for the geometry whose name or terms match the query, best first. */
	search(query: string, geometry: PresetGeometry, limit = 30): Preset[] {
		const q = normalize(query);
		if (!q) return [];
		return this.#presets
			.filter((p) => p.searchable !== false && p.geometry.includes(geometry))
			.map((preset) => ({ preset, score: searchScore(preset, q) }))
			.filter(({ score }) => score > 0)
			.sort(
				(a, b) =>
					b.score - a.score || a.preset.name.localeCompare(b.preset.name),
			)
			.slice(0, limit)
			.map(({ preset }) => preset);
	}

	#fallback(geometry: PresetGeometry): Preset {
		const id = FALLBACKS[geometry];
		return (
			this.#byId.get(id) ?? {
				id,
				name: id,
				terms: [],
				geometry: [geometry],
				tags: {},
				fields: [],
				moreFields: [],
			}
		);
	}
}

/**
 * How well a preset fits tags, as in iD: each preset tag must be present; an exact value counts
 * `matchScore`, a `*` value half of it. Generic presets without tags score 0 (fallbacks only).
 */
function matchScore(preset: Preset, tags: Tags): number {
	const weight = preset.matchScore ?? 1;
	let score = 0;
	for (const [key, value] of Object.entries(preset.tags)) {
		if (tags[key] === value) score += weight;
		else if (value === "*" && tags[key] !== undefined) score += weight / 2;
		else return -1;
	}
	return score;
}

function searchScore(preset: Preset, query: string): number {
	const name = normalize(preset.name);
	if (name === query) return 100;
	if (name.startsWith(query)) return 80;
	if (name.split(/[\s/-]+/).some((word) => word.startsWith(query))) return 60;
	const terms = preset.terms.map(normalize);
	if (terms.some((t) => t === query)) return 50;
	if (terms.some((t) => t.startsWith(query))) return 40;
	if (name.includes(query)) return 20;
	return 0;
}

/** Lower case without accents, for search. */
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();
}
