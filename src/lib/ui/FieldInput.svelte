<script lang="ts">
	import Lock from "@lucide/svelte/icons/lock";
	import type { Snippet } from "svelte";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as NativeSelect from "#lib/components/shadcn/native-select/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import type { Field as PresetField } from "#lib/presets/presets.ts";

	interface Props {
		field: PresetField;
		value: string | undefined;
		/** Called with the new value when the user commits it; "" removes the tag. */
		onchange: (value: string) => void;
		/** Shown, not editable (the name of a feature linked to Wikidata). */
		locked?: boolean;
		/** Buttons at the end of the label row (remove, revert). */
		actions?: Snippet;
	}

	let { field, value, onchange, locked = false, actions }: Props = $props();

	const id = $derived(`field-${field.id.replaceAll(/[^\w-]/g, "-")}`);
	const kind = $derived.by(() => {
		switch (field.type) {
			case "check":
			case "defaultCheck":
				return "check";
			case "radio":
				return "select";
			case "combo":
			case "typeCombo":
			case "semiCombo":
			case "multiCombo":
			case "manyCombo":
			case "access":
				return "combo";
			case "textarea":
				return "textarea";
			default:
				return "text";
		}
	});
	const checkOptions = [
		{ value: "yes", label: "Yes" },
		{ value: "no", label: "No" },
	];
	const options = $derived(kind === "check" ? checkOptions : field.options);

	function commit(event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		onchange(target.value.trim());
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
	{#if kind === "check" || kind === "select"}
		<NativeSelect.Root
			{id}
			class="w-full"
			disabled={locked}
			value={value ?? ""}
			onchange={commit}
		>
			<NativeSelect.Option value=""></NativeSelect.Option>
			{#each options as option (option.value)}
				<NativeSelect.Option value={option.value}
					>{option.label}</NativeSelect.Option
				>
			{/each}
			{#if value && !options.some((o) => o.value === value)}
				<NativeSelect.Option {value}>{value}</NativeSelect.Option>
			{/if}
		</NativeSelect.Root>
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
