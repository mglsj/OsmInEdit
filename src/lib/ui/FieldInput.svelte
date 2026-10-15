<script lang="ts">
	import Lock from "@lucide/svelte/icons/lock";
	import type { Snippet } from "svelte";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field as PresetField } from "#lib/presets/presets.ts";
	import CheckField from "#lib/ui/CheckField.svelte";
	import ChipsField from "#lib/ui/ChipsField.svelte";
	import ComboField from "#lib/ui/ComboField.svelte";
	import {
		type FieldContext,
		fieldInputId,
		type TagPatch,
	} from "#lib/ui/field-context.ts";
	import RadioField from "#lib/ui/RadioField.svelte";

	interface Props {
		field: PresetField;
		/** The feature's tags. */
		tags: Tags;
		context: FieldContext;
		/** Called with the tags to change once the user commits a value. */
		onchange: (patch: TagPatch) => void;
		/** Shown, not editable (the name of a feature linked to Wikidata). */
		locked?: boolean;
		/** Buttons at the end of the label row (remove, revert). */
		actions?: Snippet;
	}

	let {
		field,
		tags,
		context,
		onchange,
		locked = false,
		actions,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const value = $derived(field.key ? tags[field.key] : undefined);
	const kind = $derived.by(() => {
		switch (field.type) {
			case "check":
			case "defaultCheck":
			case "onewayCheck":
				return "check";
			case "radio":
			case "structureRadio":
				return "radio";
			case "combo":
			case "typeCombo":
			case "networkCombo":
				return "single-combo";
			case "semiCombo":
			case "multiCombo":
			case "manyCombo":
				return "chips";
			case "access":
				// iD's access grid comes with slice 6; until then, a text with its options.
				return "combo";
			case "textarea":
				return "textarea";
			default:
				return "text";
		}
	});
	const options = $derived(field.options);

	/** Sets the field's key to what was typed or chosen; nothing removes it. */
	function set(next: string | undefined) {
		if (field.key) onchange({ [field.key]: next || undefined });
	}

	function commit(event: Event) {
		set((event.currentTarget as HTMLInputElement).value.trim());
	}
</script>

<Field.Field class="gap-1.5">
	<div class="flex min-h-6 items-center gap-1">
		<Field.Label for={id}>{field.label}</Field.Label>
		{#if locked}
			<Lock
				role="img"
				aria-label={`${field.label} is locked: the feature is linked to Wikidata. Its tags can still be edited in Tags.`}
				class="size-3.5 text-muted-foreground"
			/>
		{/if}
		<span class="ml-auto flex items-center">{@render actions?.()}</span>
	</div>
	{#if kind === "single-combo"}
		<ComboField {field} {value} {context} {locked} onchange={set} />
	{:else if kind === "chips"}
		<ChipsField {field} {tags} {context} {locked} {onchange} />
	{:else if kind === "check"}
		<CheckField {field} {value} {locked} onchange={set} />
	{:else if kind === "radio"}
		<RadioField {field} {tags} {context} {locked} {onchange} />
	{:else if kind === "textarea"}
		<Textarea
			{id}
			rows={3}
			value={value ?? ""}
			readonly={locked}
			onchange={commit}
		/>
	{:else}
		<Input
			{id}
			type="text"
			value={value ?? ""}
			placeholder={field.placeholder}
			readonly={locked}
			list={kind === "combo" && options.length > 0
				? `${id}-options`
				: undefined}
			autocomplete="off"
			onchange={commit}
		/>
		{#if kind === "combo" && options.length > 0}
			<datalist id={`${id}-options`}>
				{#each options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</datalist>
		{/if}
	{/if}
</Field.Field>
