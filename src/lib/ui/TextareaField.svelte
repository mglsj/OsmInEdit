<script lang="ts">
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue, textPatch, textValue } from "#lib/presets/text.ts";
	import { fieldInputId, type TagPatch } from "#lib/ui/field-context.ts";
	import LengthIndicator from "#lib/ui/LengthIndicator.svelte";
	import { liveText } from "#lib/ui/live-text.ts";

	interface Props {
		field: Field;
		tags: Tags;
		locked: boolean;
		/** A change; `live` while typing (kept as typed, one undo step with the final value). */
		onchange: (patch: TagPatch, live?: boolean) => void;
	}

	let { field, tags, locked, onchange }: Props = $props();

	const current = $derived(textValue(field, tags));
	let typed = $derived(current.value);

	let textarea = $state<HTMLTextAreaElement | null>(null);

	/** Text applied as it is typed, as iD; an emptied field waits until it is left. */
	const live = liveText((text) => {
		if (locked || current.mixed || !cleanValue(text)) return;
		appliedLive = true;
		onchange(textPatch(field, tags, text), true);
	});
	/** Whether text was applied while typing: leaving the field then ends that undo step. */
	let appliedLive = false;

	function commit(target: HTMLTextAreaElement) {
		live.cancel();
		appliedLive = false;
		const value = cleanValue(target.value);
		if (!value && current.mixed) return;
		target.value = value;
		typed = value;
		// Even unchanged: leaving the field ends the undo step typing made.
		onchange(textPatch(field, tags, value));
	}

	// Typed text isn't lost when the field goes.
	$effect(() => () => {
		if (live.cancel() && textarea) commit(textarea);
	});
</script>

<InputGroup.Root data-disabled={locked}>
	<InputGroup.Textarea
		bind:ref={textarea}
		id={fieldInputId(field)}
		rows={3}
		dir="auto"
		value={current.value}
		placeholder={current.mixed
			? "Multiple values"
			: (field.placeholder ?? "Unknown")}
		readonly={locked}
		oninput={(event) => {
			typed = event.currentTarget.value;
			live.typed(typed);
		}}
		onchange={(event) => commit(event.currentTarget)}
		onblur={(event) => {
			// No change event for text typed back as it was: still the end of the edit.
			if (live.cancel() || appliedLive) commit(event.currentTarget);
		}}
	/>
	<InputGroup.Addon align="block-end" class="justify-end">
		<LengthIndicator value={typed} />
	</InputGroup.Addon>
</InputGroup.Root>
