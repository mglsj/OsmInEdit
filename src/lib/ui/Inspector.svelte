<script lang="ts">
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import X from "@lucide/svelte/icons/x";
	import { iconUrl } from "#lib/map/style/icons.ts";
	import { formatTagText, parseTagText } from "#lib/osm/tag-text.ts";
	import type { Field, Preset } from "#lib/presets/presets.ts";
	import type { Editor } from "#lib/state/editor.svelte.ts";
	import FieldInput from "#lib/ui/FieldInput.svelte";

	interface Props {
		editor: Editor;
		/** The selected entity (the panel is only shown with one). */
		entity: NonNullable<Editor["selected"]>;
	}

	let { editor, entity }: Props = $props();

	let choosing = $state(false);
	let query = $state("");

	const geometry = $derived(editor.geometryOf(entity));
	const preset = $derived(editor.presetOf(entity));
	const fields = $derived(
		preset && editor.presets
			? editor.presets.fieldsOf(preset)
			: { fields: [], moreFields: [] },
	);
	/** Optional fields are shown once they have a value. */
	const shownFields = $derived([
		...fields.fields,
		...fields.moreFields.filter(
			(f) => f.key !== undefined && entity.tags[f.key] !== undefined,
		),
	]);
	const issues = $derived(editor.issuesOf(entity.id));
	const results = $derived(
		editor.presets
			? query.trim()
				? editor.presets.search(query, geometry)
				: editor.presets.defaults(geometry)
			: [],
	);

	function setField(field: Field, value: string) {
		if (!field.key) return;
		const tags: Record<string, string> = { ...entity.tags };
		if (value) tags[field.key] = value;
		else delete tags[field.key];
		editor.setTags(entity.id, tags);
	}

	function choose(next: Preset) {
		editor.setPreset(entity, next);
		choosing = false;
		query = "";
	}

	function onPickerKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			choosing = false;
		}
	}
</script>

{#snippet presetIcon(
	preset: Preset | undefined,
	size: number,
)}
	{@const url = iconUrl(preset?.icon)}
	{#if url}
		<img
			src={url}
			alt=""
			width={size}
			height={size}
			class="shrink-0 dark:invert"
		>
	{:else}
		<span class="shrink-0" style:width="{size}px"></span>
	{/if}
{/snippet}

<aside
	aria-label="Feature editor"
	class="flex h-full w-88 max-w-[calc(100vw-2rem)] flex-col border-l border-black/10 bg-white shadow-lg dark:border-white/15 dark:bg-slate-900"
>
	<header
		class="flex items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15"
	>
		{@render presetIcon(preset, 24)}
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-base font-semibold">
				{preset?.name ?? "Feature"}
			</h2>
			<p class="text-xs text-slate-500 dark:text-slate-400">{entity.id}</p>
		</div>
		<button
			type="button"
			onclick={() => (choosing = !choosing)}
			aria-expanded={choosing}
			class="rounded px-2 py-1 text-sm text-brand-600 hover:bg-slate-100 dark:text-brand-50 dark:hover:bg-slate-800"
		>
			Change type
		</button>
		<button
			type="button"
			aria-label="Close"
			onclick={() => editor.select(null)}
			class="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
		>
			<X size={18} aria-hidden="true" />
		</button>
	</header>

	<div class="flex-1 overflow-y-auto">
		{#if choosing}
			<div class="flex flex-col gap-2 p-4">
				<label class="sr-only" for="preset-search">Search feature types</label>
				<input
					id="preset-search"
					type="search"
					bind:value={query}
					placeholder="Search feature types"
					autocomplete="off"
					onkeydown={onPickerKeydown}
					{@attach (input) => input.focus()}
					class="w-full rounded border border-black/15 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-slate-900"
				>
				<ul aria-label="Feature types" class="flex flex-col">
					{#each results as result (result.id)}
						<li>
							<button
								type="button"
								onclick={() => choose(result)}
								class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
							>
								{@render presetIcon(result, 16)}
								{result.name}
							</button>
						</li>
					{:else}
						<li class="px-2 py-1.5 text-sm text-slate-500">
							No feature type found
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			{#if issues.length > 0}
				<section
					aria-label="Issues"
					class="flex flex-col gap-2 border-b border-black/10 p-4 dark:border-white/15"
				>
					{#each issues as issue (issue.id)}
						<div
							class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
						>
							<p class="flex gap-2">
								<TriangleAlert
									size={16}
									class="mt-0.5 shrink-0"
									aria-hidden="true"
								/>
								{issue.message}
							</p>
							{#if issue.fix}
								<button
									type="button"
									onclick={() => editor.fix(issue)}
									class="mt-2 rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
								>
									{issue.fix.label}
								</button>
							{/if}
						</div>
					{/each}
				</section>
			{/if}

			<section aria-label="Fields" class="flex flex-col gap-3 p-4">
				{#each shownFields as field (field.id)}
					<FieldInput
						{field}
						value={field.key ? entity.tags[field.key] : undefined}
						onchange={(value) => setField(field, value)}
					/>
				{/each}
			</section>

			<section
				class="flex flex-col gap-1 border-t border-black/10 p-4 dark:border-white/15"
			>
				<label
					for="raw-tags"
					class="text-xs font-medium text-slate-600 dark:text-slate-300"
				>
					Tags
				</label>
				<textarea
					id="raw-tags"
					rows="6"
					spellcheck="false"
					value={formatTagText(entity.tags)}
					onchange={(event) =>
						editor.setTags(entity.id, parseTagText(event.currentTarget.value))}
					class="w-full rounded border border-black/15 px-2 py-1 font-mono text-xs focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-slate-900"
				></textarea>
			</section>
		{/if}
	</div>
</aside>
