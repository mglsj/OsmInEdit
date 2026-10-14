/**
 * Extracts the presets IndoorID needs from iD's tagging schema
 * (@openstreetmap/id-tagging-schema, ISC) into src/lib/presets/generated/, with English
 * labels resolved, and copies the Maki and Temaki icons (CC0) they use into its `icons/`.
 * Runs on `bun install` (the `prepare` script); the output is not committed.
 *
 * Usage: bun scripts/build-presets.ts
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import overlay from "../src/lib/presets/overlay.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = join(root, "node_modules/@openstreetmap/id-tagging-schema/dist");
const out = join(root, "src/lib/presets/generated");

type Json = Record<string, unknown>;
const read = (file: string) =>
	JSON.parse(readFileSync(join(schema, file), "utf8"));

const presets: Record<string, Json> = read("presets.json");
const fields: Record<string, Json> = read("fields.json");
const deprecated: unknown[] = read("deprecated.json");
const strings = read("translations/en.json").en.presets as {
	presets: Record<string, Json>;
	fields: Record<string, Json>;
};

/** Top-level preset ids kept whole: things found inside buildings, and the fallbacks. */
const KEPT_GROUPS = new Set([
	"point",
	"line",
	"area",
	"relation",
	"indoor",
	"entrance",
	"amenity",
	"shop",
	"office",
	"craft",
	"healthcare",
	"emergency",
	"tourism",
	"leisure",
	"building",
	"building_part",
	"barrier",
	"public_transport",
	"advertising",
	"police",
	"polling_station",
	"education",
	"club",
]);

/** Single presets kept from other groups. */
const KEPT_PRESETS =
	/^(highway\/(elevator|steps|corridor|footway(\/conveying)?|pedestrian_area)|railway\/platform|type\/multipolygon)$/;

function isKept(id: string, preset: Json): boolean {
	if (id.startsWith("@")) return false;
	if (preset.replacement) return false; // deprecated presets
	return KEPT_GROUPS.has(id.split("/")[0] ?? "") || KEPT_PRESETS.test(id);
}

const outPresets: Json[] = [];
const usedFields = new Set<string>();

for (const [id, preset] of Object.entries(presets)) {
	if (!isKept(id, preset)) continue;
	const text = strings.presets[id] ?? {};
	const own = {
		id,
		name: (text.name as string | undefined) ?? id,
		terms: [
			...((text.terms as string[] | undefined) ?? []),
			...((text.aliases as string[] | undefined) ?? []),
		],
		icon: preset.icon,
		geometry: preset.geometry,
		tags: preset.tags,
		addTags: preset.addTags,
		removeTags: preset.removeTags,
		matchScore: preset.matchScore,
		searchable: preset.searchable,
		fields: preset.fields ?? [],
		moreFields: preset.moreFields ?? [],
	};
	for (const field of [...own.fields, ...own.moreFields] as string[]) {
		usedFields.add(field);
	}
	outPresets.push(own);
}

// Local presets and fields fill the gaps of the schema for Simple Indoor Tagging.
for (const preset of overlay.presets) {
	for (const field of [...preset.fields, ...(preset.moreFields ?? [])]) {
		usedFields.add(field);
	}
	outPresets.push(preset);
}

const outFields: Json[] = [];
for (const id of usedFields) {
	const field = fields[id];
	const local = (overlay.fields as Record<string, Json>)[id];
	if (!field && !local) continue;
	const text = strings.fields[id] ?? {};
	const labels = (text.options ?? {}) as Record<
		string,
		string | { title: string }
	>;
	const values =
		(local?.options as string[] | undefined) ??
		(field?.options as string[] | undefined) ??
		Object.keys(labels);
	outFields.push({
		id,
		key: field?.key ?? local?.key,
		keys: field?.keys,
		type: local?.type ?? field?.type,
		label: (local?.label as string | undefined) ?? text.label ?? id,
		placeholder: text.placeholder,
		options: values.map((value) => {
			const label = labels[value];
			return {
				value,
				label:
					typeof label === "string" ? label : (label?.title ?? humanize(value)),
			};
		}),
		prerequisiteTag: field?.prerequisiteTag,
	});
}

/** `slowdown_button` → `Slowdown button`, for options the schema doesn't label. */
function humanize(value: string): string {
	const text = value.replaceAll("_", " ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

mkdirSync(out, { recursive: true });
const write = (file: string, data: unknown) =>
	writeFileSync(join(out, file), JSON.stringify(data));
write("presets.json", outPresets);
write("fields.json", outFields);
write("deprecated.json", deprecated);

/** Icon sets bundled for the map, by the prefix of iD's icon names (`maki-toilet`). */
const ICON_SETS: Record<string, string> = {
	maki: "node_modules/@mapbox/maki/icons",
	temaki: "node_modules/@rapideditor/temaki/icons",
};
const iconsOut = join(out, "icons");
rmSync(iconsOut, { recursive: true, force: true });
mkdirSync(iconsOut);
let icons = 0;
for (const icon of new Set(outPresets.map((p) => p.icon))) {
	if (typeof icon !== "string") continue;
	const [, set, name] = icon.match(/^(\w+)-(.+)$/) ?? [];
	const dir = set && ICON_SETS[set];
	if (!dir) continue;
	const file = join(root, dir, `${name}.svg`);
	if (!existsSync(file)) continue;
	copyFileSync(file, join(iconsOut, `${icon}.svg`));
	icons++;
}

console.log(
	`Presets: ${outPresets.length} presets, ${outFields.length} fields, ${icons} icons → src/lib/presets/generated/`,
);
