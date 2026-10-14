<script lang="ts">
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import X from "@lucide/svelte/icons/x";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Separator } from "#lib/components/shadcn/separator/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import { iconUrl } from "#lib/map/style/icons.ts";
	import { formatTagText, parseTagText } from "#lib/osm/tag-text.ts";
	import type { Preset, Field as PresetField } from "#lib/presets/presets.ts";
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
	class="flex h-full w-88 max-w-[calc(100vw-2rem)] flex-col border-l bg-background shadow-lg"
>
	<header class="flex items-center gap-2 px-4 py-3">
		{@render presetIcon(preset, 24)}
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-base font-semibold">
				{preset?.name ?? "Feature"}
			</h2>
			<p class="text-xs text-muted-foreground">{entity.id}</p>
		</div>
		<Button
			variant="ghost"
			size="sm"
			aria-expanded={choosing}
			onclick={() => (choosing = !choosing)}
		>
			Change type
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Close"
			onclick={() => editor.select(null)}
		>
			<X />
		</Button>
	</header>
	<Separator />

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
			{#if issues.length > 0}
				<section aria-label="Issues" class="flex flex-col gap-2 p-4">
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
				</section>
				<Separator />
			{/if}

			<section aria-label="Fields" class="p-4">
				<Field.Group class="gap-4">
					{#each shownFields as field (field.id)}
						<FieldInput
							{field}
							value={field.key ? entity.tags[field.key] : undefined}
							onchange={(value) => setField(field, value)}
						/>
					{/each}
				</Field.Group>
			</section>
			<Separator />

			<div class="p-4">
				<Field.Field>
					<Field.Label for="raw-tags">Tags</Field.Label>
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
			</div>
		</ScrollArea>
	{/if}
</aside>
