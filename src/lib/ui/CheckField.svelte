<script lang="ts">
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import { checkState, nextCheckValue } from "#lib/presets/choice.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { fieldInputId } from "#lib/ui/field-context.ts";

	interface Props {
		/** A check or defaultCheck field. */
		field: Field;
		value: string | undefined;
		locked: boolean;
		onchange: (value: string | undefined) => void;
	}

	let { field, value, locked, onchange }: Props = $props();

	const id = $derived(fieldInputId(field));
	const state = $derived(checkState(field, value));
	const option = $derived(
		field.options.find((o) => o.value === value?.toLowerCase()),
	);
</script>

<!-- As iD: one box cycling through unset, yes and no, with the value's text beside it. -->
<div class="flex h-8 items-center gap-2">
	<Checkbox
		{id}
		bind:checked={() => state.checked, () => {}}
		bind:indeterminate={() => state.indeterminate, () => {}}
		disabled={locked}
		title={value ? `${field.key}=${value}` : undefined}
		onCheckedChange={() => onchange(nextCheckValue(field, value))}
	/>
	<span
		class={[
			"text-sm",
			value === undefined && "text-muted-foreground",
			state.raw && "font-mono text-xs",
		]}
		title={option?.description}
		>{state.text}</span
	>
</div>
