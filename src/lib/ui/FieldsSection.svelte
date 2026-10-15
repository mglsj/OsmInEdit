<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import {
		addField,
		fieldList,
		hasValue,
		isLocked,
		isModified,
		matchesField,
		removeField,
		revertField,
	} from "#lib/presets/field-list.ts";
	import type { Preset, Field as PresetField } from "#lib/presets/presets.ts";
	import type { Editor } from "#lib/state/editor.svelte.ts";
	import FieldInput from "#lib/ui/FieldInput.svelte";

	interface Props {
		editor: Editor;
		entity: NonNullable<Editor["selected"]>;
		/** The feature's type; the section is made anew when it changes, as in iD. */
		preset: Preset;
	}

	let { editor, entity, preset }: Props = $props();

	/** Fields added from "Add field", or emptied here: they stay until the feature is left. */
	const added = new SvelteSet<string>();
	let adding = $state(false);
	let query = $state("");

	const list = $derived(
		editor.presets
			? fieldList(
					editor.presets,
					preset,
					entity.tags,
					editor.geometryOf(entity),
					added,
				)
			: { shown: [], addable: [] },
	);
	const downloaded = $derived(editor.downloadedTags(entity.id));
	const found = $derived(
		query.trim()
			? list.addable.filter((f) => matchesField(f, query))
			: list.addable,
	);
	/** iD's hint: the first fields that can be added. */
	const hint = $derived(
		list.addable
			.slice(0, 3)
			.map((f) => f.label)
			.join(", ") + (list.addable.length > 3 ? "…" : ""),
	);

	function setField(field: PresetField, value: string) {
		if (!field.key) return;
		const tags: Record<string, string> = { ...entity.tags };
		if (value) tags[field.key] = value;
		else delete tags[field.key];
		editor.setTags(entity.id, tags);
	}

	function remove(field: PresetField) {
		added.add(field.id);
		editor.setTags(entity.id, removeField(field, entity.tags));
	}

	async function add(field: PresetField) {
		adding = false;
		query = "";
		added.add(field.id);
		const tags = addField(field, entity.tags);
		if (tags !== entity.tags) editor.setTags(entity.id, tags);
		await tick();
		document.getElementById(inputId(field))?.focus();
	}

	/** The id FieldInput gives its input. */
	const inputId = (field: PresetField) =>
		`field-${field.id.replaceAll(/[^\w-]/g, "-")}`;
</script>

<Field.Group class="gap-4">
	{#each list.shown as field (field.id)}
		{@const locked = isLocked(field, entity.tags)}
		<FieldInput
			{field}
			{locked}
			value={field.key ? entity.tags[field.key] : undefined}
			onchange={(value) => setField(field, value)}
		>
			{#snippet actions()}
				{#if !locked && isModified(field, downloaded, entity.tags)}
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Revert ${field.label}`}
						title="Revert to the downloaded value"
						onclick={() =>
							editor.setTags(
								entity.id,
								revertField(field, downloaded, entity.tags),
							)}
					>
						<Undo2 />
					</Button>
				{/if}
				{#if !locked && hasValue(field, entity.tags)}
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Remove ${field.label}`}
						title="Remove"
						class="text-muted-foreground hover:text-destructive"
						onclick={() => remove(field)}
					>
						<Trash2 />
					</Button>
				{/if}
			{/snippet}
		</FieldInput>
	{/each}
</Field.Group>

{#if list.addable.length > 0}
	<Popover.Root bind:open={adding}>
		<Popover.Trigger>
			{#snippet child({
				props,
			})}
				<Button
					{...props}
					variant="outline"
					class="mt-4 w-full justify-start font-normal"
					aria-label="Add field"
				>
					<Plus />
					<span class="truncate text-muted-foreground">Add field: {hint}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start">
			<Command.Root shouldFilter={false} label="Search fields">
				<Command.Input bind:value={query} placeholder="Search fields" />
				<Command.List>
					<Command.Empty>No field found</Command.Empty>
					<Command.Group>
						{#each found as field (field.id)}
							<Command.Item value={field.id} onSelect={() => add(field)}>
								{field.label}
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
{/if}
