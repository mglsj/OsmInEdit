/**
 * Browsing the map: a click selects the feature under it (or clears the selection), the
 * cursor shows what can be selected, Escape clears the selection.
 */
import type { Mode } from "../mode.ts";

export interface BrowseOptions {
	/** The feature drawn at a screen point, topmost first, if any. */
	readonly hitTest: (point: { x: number; y: number }) => string | null;
	readonly select: (id: string | null) => void;
}

export function browseMode({ hitTest, select }: BrowseOptions): Mode {
	return {
		name: "browse",
		hover: (at) => (hitTest(at.point) ? "pointer" : ""),
		click: (at) => select(hitTest(at.point)),
		key(event) {
			if (event.key !== "Escape") return false;
			select(null);
			return true;
		},
	};
}
