/** The raw tag editor's text form: one `key=value` per line. */
import type { Tags } from "./tags.ts";

export function formatTagText(tags: Tags): string {
	return Object.keys(tags)
		.sort()
		.map((key) => `${key}=${tags[key]}`)
		.join("\n");
}

/** Reads `key=value` lines, skipping lines without a key or a value. */
export function parseTagText(text: string): Tags {
	const tags: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const at = line.indexOf("=");
		if (at < 0) continue;
		const key = line.slice(0, at).trim();
		const value = line.slice(at + 1).trim();
		if (key && value) tags[key] = value;
	}
	return tags;
}
