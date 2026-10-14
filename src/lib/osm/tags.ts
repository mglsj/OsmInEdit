/** OSM tags of an entity. Keys and values are non-empty strings. */
export type Tags = Readonly<Record<string, string>>;

/** Keys that don't make a node worth keeping on their own: a vertex with only these is geometry. */
const UNINTERESTING_KEYS = new Set([
	"created_by",
	"source",
	"level",
	"repeat_on",
]);

/** Whether an entity carries information beyond its geometry (a POI, a door, ...). */
export function hasInterestingTags(tags: Tags): boolean {
	return Object.keys(tags).some((key) => !UNINTERESTING_KEYS.has(key));
}
