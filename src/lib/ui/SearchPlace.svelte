<script lang="ts">
	import Search from "@lucide/svelte/icons/search";
	import { type Place, searchPlaces } from "#lib/api/nominatim.ts";
	import type { Bbox } from "#lib/api/osm-api.ts";

	interface Props {
		/** Area to search near, usually the visible map. */
		getView: () => Bbox | undefined;
		onselect: (place: Place) => void;
		baseUrl?: string;
	}

	let { getView, onselect, baseUrl }: Props = $props();

	let query = $state("");
	let results = $state.raw<Place[] | null>(null);
	let error = $state<string | null>(null);
	let searching = $state(false);
	let controller: AbortController | undefined;

	async function search(event: SubmitEvent) {
		event.preventDefault();
		const near = getView();
		if (!near) return;
		controller?.abort();
		controller = new AbortController();
		searching = true;
		error = null;
		try {
			results = await searchPlaces(query, {
				near,
				baseUrl,
				signal: controller.signal,
			});
		} catch (e) {
			if ((e as Error).name !== "AbortError") {
				error = (e as Error).message;
				results = null;
			}
		} finally {
			searching = false;
		}
	}

	function select(place: Place) {
		results = null;
		onselect(place);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === "Escape") results = null;
	}
</script>

<div class="w-80 max-w-[calc(100vw-6rem)]" {onkeydown} role="presentation">
	<search>
		<form
			onsubmit={search}
			class="flex overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/10 focus-within:ring-2 focus-within:ring-brand-500 dark:bg-slate-900 dark:ring-white/15"
		>
			<label class="sr-only" for="place-search">Search a place</label>
			<input
				id="place-search"
				type="search"
				bind:value={query}
				placeholder="Search a place"
				autocomplete="off"
				class="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-400"
			>
			<button
				type="submit"
				aria-label="Search"
				disabled={searching}
				class="flex w-10 items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
			>
				<Search size={16} aria-hidden="true" />
			</button>
		</form>
	</search>

	{#if results}
		<ul
			aria-label="Search results"
			class="mt-1 max-h-80 overflow-y-auto rounded-md bg-white py-1 shadow-md ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15"
		>
			{#each results as place (place.description)}
				<li>
					<button
						type="button"
						onclick={() => select(place)}
						class="block w-full px-3 py-2 text-left hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
					>
						<span class="block text-sm font-medium">{place.name}</span>
						{#if place.description !== place.name}
							<span
								class="block truncate text-xs text-slate-500 dark:text-slate-400"
							>
								{place.description}
							</span>
						{/if}
					</button>
				</li>
			{:else}
				<li class="px-3 py-2 text-sm text-slate-500">No place found</li>
			{/each}
		</ul>
	{/if}

	{#if error}
		<p
			role="alert"
			class="mt-1 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 shadow"
		>
			{error}
		</p>
	{/if}
</div>
