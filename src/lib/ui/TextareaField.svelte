<script lang="ts">
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue, textPatch, textValue } from "#lib/presets/text.ts";
	import { fieldInputId, type TagPatch } from "#lib/ui/field-context.ts";
	import LengthIndicator from "#lib/ui/LengthIndicator.svelte";

	interface Props {
		field: Field;
		tags: Tags;
		locked: boolean;
		onchange: (patch: TagPatch) => void;
	}

	let { field, tags, locked, onchange }: Props = $props();

	const current = $derived(textValue(field, tags));
	let typed = $derived(current.value);

	function commit(target: HTMLTextAreaElement) {
		const value = cleanValue(target.value);
		if (!value && current.mixed) return;
		target.value = value;
		typed = value;
		if (value !== current.value) onchange(textPatch(field, tags, value));
	}
</script>

<InputGroup.Root data-disabled={locked}>
	<InputGroup.Textarea
		id={fieldInputId(field)}
		rows={3}
		dir="auto"
		value={current.value}
		placeholder={current.mixed
			? "Multiple values"
			: (field.placeholder ?? "Unknown")}
		readonly={locked}
		oninput={(event) => (typed = event.currentTarget.value)}
		onchange={(event) => commit(event.currentTarget)}
	/>
	<InputGroup.Addon align="block-end" class="justify-end">
		<LengthIndicator value={typed} />
	</InputGroup.Addon>
</InputGroup.Root>
