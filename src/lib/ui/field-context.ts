import type { SuggestedValue } from "#lib/presets/combo.ts";
import type { Field } from "#lib/presets/presets.ts";

/** What field inputs need from the editor, beyond their own tags. */
export interface FieldContext {
	/**
	 * Values used elsewhere for the field (taginfo), for what was typed; for a multiCombo, the
	 * keys under its prefix. Absent when there is no taginfo.
	 */
	readonly suggest?: (
		field: Field,
		query: string,
	) => Promise<readonly SuggestedValue[]>;
	/** Values the schema deprecates for a key. */
	readonly deprecated: (key: string) => readonly string[];
	/** A field of the schema by id (a structure's type field). */
	readonly field?: (id: string) => Field | undefined;
	/** Values for a part of an address (`addr:street`) from the data around the feature. */
	readonly nearby?: (key: string, part: string) => readonly string[];
}

export type { TagPatch } from "#lib/presets/combo.ts";

/** The id of a field's input, which its label points at. */
export function fieldInputId(field: Field): string {
	return `field-${field.id.replaceAll(/[^\w-]/g, "-")}`;
}
