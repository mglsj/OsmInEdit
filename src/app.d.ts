// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	/** Short git commit hash of the build, injected by Vite. */
	const __GIT_HASH__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
