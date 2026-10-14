/** Loads the generated preset data (see scripts/build-presets.ts) on first use. */
import type { UpgradeRule } from "#lib/validation/upgrades.ts";
import { type Field, type Preset, PresetIndex } from "./presets.ts";

let loading: Promise<PresetIndex> | undefined;

export function loadPresetIndex(): Promise<PresetIndex> {
	loading ??= Promise.all([
		import("./generated/presets.json"),
		import("./generated/fields.json"),
	]).then(
		([presets, fields]) =>
			new PresetIndex(
				presets.default as unknown as Preset[],
				fields.default as unknown as Field[],
			),
	);
	return loading;
}

/** Tag upgrades from the schema's deprecated-tag list. */
export async function loadSchemaUpgrades(): Promise<UpgradeRule[]> {
	const { default: rules } = await import("./generated/deprecated.json");
	return rules as unknown as UpgradeRule[];
}
