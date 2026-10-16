/**
 * Text applied while it is typed, as iD's `onInput` changes, after a short pause: every change
 * redraws all the map's features until P5.2, so applying each keystroke would lag on large
 * areas. Leaving the field still applies what was typed at once.
 */
export const LIVE_DELAY = 150;

export function liveText(apply: (text: string) => void, delay = LIVE_DELAY) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		/** Text typed: applied once typing pauses. */
		typed(text: string) {
			clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				apply(text);
			}, delay);
		},
		/** Drops the text waiting to be applied; returns whether there was some. */
		cancel(): boolean {
			const waiting = timer !== undefined;
			clearTimeout(timer);
			timer = undefined;
			return waiting;
		},
	};
}
