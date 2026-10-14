<script lang="ts">
	import Layers from "@lucide/svelte/icons/layers";
	import {
		availableImagery,
		type ImageryEntry,
		loadImageryIndex,
	} from "#lib/map/imagery.ts";

	interface Props {
		/** Map centre, [lon, lat], to list the imagery covering it. */
		center: [number, number] | undefined;
		/** Selected imagery id, or null for the basemap only. */
		selected: string | null;
		onselect: (entry: ImageryEntry | null) => void;
		indexUrl?: string;
	}

	let { center, selected, onselect, indexUrl }: Props = $props();

	let open = $state(false);
	let entries = $state.raw<ImageryEntry[] | null>(null);
	let error = $state<string | null>(null);

	const available = $derived(
		entries && center ? availableImagery(entries, center) : [],
	);

	async function toggle() {
		open = !open;
		if (open && !entries) {
			try {
				entries = await loadImageryIndex(indexUrl);
			} catch (e) {
				error = (e as Error).message;
			}
		}
	}

	function choose(id: string | null) {
		onselect(id === null ? null : (available.find((e) => e.id === id) ?? null));
	}
</script>

<div class="flex flex-col items-start gap-1">
	<button
		type="button"
		onclick={toggle}
		aria-expanded={open}
		aria-controls="imagery-list"
		class="flex h-9 items-center gap-2 rounded-md bg-white px-3 text-sm shadow-md ring-1 ring-black/10 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 dark:bg-slate-900 dark:ring-white/15 dark:hover:bg-slate-800"
	>
		<Layers size={16} aria-hidden="true" />
		Background
	</button>

	{#if open}
		<fieldset
			id="imagery-list"
			class="max-h-72 w-72 overflow-y-auto rounded-md bg-white p-2 text-sm shadow-md ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15"
		>
			<legend class="sr-only">Background imagery</legend>
			<label
				class="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
			>
				<input
					type="radio"
					name="imagery"
					checked={selected === null}
					onchange={() => choose(null)}
				>
				Map
			</label>
			{#if error}
				<p role="alert" class="px-2 py-1 text-amber-800">{error}</p>
			{:else if !entries}
				<p class="px-2 py-1 text-slate-500">Loading imagery list…</p>
			{:else}
				{#each available as entry (entry.id)}
					<label
						class="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
					>
						<input
							type="radio"
							name="imagery"
							checked={selected === entry.id}
							onchange={() => choose(entry.id)}
						>
						<span class="truncate">{entry.name}</span>
					</label>
				{/each}
			{/if}
		</fieldset>
	{/if}
</div>
