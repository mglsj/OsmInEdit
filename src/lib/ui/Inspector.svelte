<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import X from "@lucide/svelte/icons/x";
	import { untrack } from "svelte";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import { iconUrl } from "#lib/map/style/icons.ts";
	import { isNewId, osmId } from "#lib/osm/entity.ts";
	import { formatTagText, parseTagText } from "#lib/osm/tag-text.ts";
	import type { Preset, Field as PresetField } from "#lib/presets/presets.ts";
	import type { Editor } from "#lib/state/editor.svelte.ts";
	import FieldInput from "#lib/ui/FieldInput.svelte";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import { timeAgo } from "#lib/ui/time-ago.ts";

	interface Props {
		editor: Editor;
		/**
		 * The selected entity (the panel is only shown with one). The panel is made anew for each
		 * selection: what it shows first, and its ✓, are about the feature as selected.
		 */
		entity: NonNullable<Editor["selected"]>;
		/** openstreetmap.org, or the configured website, for "View on openstreetmap.org". */
		websiteUrl: string;
	}

	let { editor, entity, websiteUrl }: Props = $props();

	/** The feature as selected: closing turns into a ✓ once it was changed. */
	const selectedAs = untrack(() => entity);
	const changed = $derived(entity !== selectedAs);

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
	/** Features without a matching type show their tags, the only way to edit them. */
	const isFallback = $derived(
		preset !== undefined && editor.presets?.isFallback(preset) === true,
	);
	const tagCount = $derived(Object.keys(entity.tags).length);
	const osmUrl = $derived(
		`${websiteUrl.replace(/\/$/, "")}/${entity.type}/${osmId(entity.id)}`,
	);
	const lastEdited = $derived(
		entity.timestamp ? timeAgo(entity.timestamp) : null,
	);
	const results = $derived(
		editor.presets
			? query.trim()
				? editor.presets.search(query, geometry)
				: editor.presets.defaults(geometry)
			: [],
	);

	function setField(field: PresetField, value: string) {
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
	class="flex h-full w-88 max-w-[calc(100vw-2rem)] flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b px-4 py-3">
		<h2 class="min-w-0 flex-1 truncate text-base font-semibold">
			{choosing ? "Select feature type" : "Edit feature"}
		</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={changed ? "Done" : "Close"}
			title={changed ? "Done" : "Close"}
			onclick={() => editor.select(null)}
		>
			{#if changed}
				<Check />
			{:else}
				<X />
			{/if}
		</Button>
	</header>

	{#if choosing}
		<Command.Root
			shouldFilter={false}
			label="Search feature types"
			class="min-h-0 flex-1 rounded-none!"
		>
			<Command.Input
				bind:value={query}
				placeholder="Search feature types"
				autocomplete="off"
				onkeydown={onPickerKeydown}
				{@attach (input) => input.focus()}
			/>
			<Command.List class="max-h-none flex-1">
				<Command.Empty>No feature type found</Command.Empty>
				<Command.Group>
					{#each results as result (result.id)}
						<Command.Item value={result.id} onSelect={() => choose(result)}>
							{@render presetIcon(result, 16)}
							{result.name}
						</Command.Item>
					{/each}
				</Command.Group>
			</Command.List>
		</Command.Root>
	{:else}
		<ScrollArea class="min-h-0 flex-1">
			<InspectorSection id="feature-type" title="Feature Type">
				<button
					type="button"
					class="flex w-full items-center gap-3 rounded-md border p-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
					aria-label={`${preset?.name ?? "Feature"}, change feature type`}
					onclick={() => (choosing = true)}
				>
					{@render presetIcon(preset, 28)}
					<span class="min-w-0 flex-1">
						<span class="block truncate font-medium">
							{preset?.name ?? "Feature"}
						</span>
						<span class="block text-xs text-muted-foreground">{entity.id}</span>
					</span>
					<ChevronRight class="size-4 shrink-0 text-muted-foreground" />
				</button>
			</InspectorSection>

			{#if issues.length > 0}
				<InspectorSection id="issues" title={`Issues (${issues.length})`}>
					<div class="flex flex-col gap-2">
						{#each issues as issue (issue.id)}
							<Alert.Root role="note">
								<TriangleAlert />
								<Alert.Description>{issue.message}</Alert.Description>
								{#if issue.fix}
									<div class="col-start-2 mt-2">
										<Button
											variant="outline"
											size="xs"
											onclick={() => editor.fix(issue)}
										>
											{issue.fix.label}
										</Button>
									</div>
								{/if}
							</Alert.Root>
						{/each}
					</div>
				</InspectorSection>
			{/if}

			<InspectorSection id="fields" title="Fields">
				<Field.Group class="gap-4">
					{#each shownFields as field (field.id)}
						<FieldInput
							{field}
							value={field.key ? entity.tags[field.key] : undefined}
							onchange={(value) => setField(field, value)}
						/>
					{/each}
				</Field.Group>
			</InspectorSection>

			<InspectorSection
				id="tags"
				title={`Tags (${tagCount})`}
				defaultOpen={false}
				forceOpen={isFallback}
			>
				<Field.Field>
					<Field.Label for="raw-tags" class="sr-only">Tags</Field.Label>
					<Textarea
						id="raw-tags"
						rows={6}
						spellcheck="false"
						class="font-mono text-xs"
						value={formatTagText(entity.tags)}
						onchange={(event) =>
							editor.setTags(
								entity.id,
								parseTagText(event.currentTarget.value),
							)}
					/>
				</Field.Field>
			</InspectorSection>
		</ScrollArea>

		{#if !isNewId(entity.id)}
			<footer class="border-t px-4 py-3 text-sm">
				<a
					href={osmUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
				>
					View on openstreetmap.org
					<ExternalLink class="size-3.5" aria-hidden="true" />
				</a>
				{#if lastEdited}
					<p class="text-xs text-muted-foreground">
						Last edited {lastEdited}{entity.user ? ` by ${entity.user}` : ""}
					</p>
				{/if}
			</footer>
		{/if}
	{/if}
</aside>
