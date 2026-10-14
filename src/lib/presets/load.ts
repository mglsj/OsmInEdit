/** Loads the generated preset data (see scripts/build-presets.ts) on first use. */
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
