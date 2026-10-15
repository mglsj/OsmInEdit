<script lang="ts">
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { SvelteSet } from "svelte/reactivity";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import type {
		Preset,
		PresetCategory,
		PresetGeometry,
		PresetIndex,
	} from "#lib/presets/presets.ts";
	import PresetIcon from "#lib/ui/PresetIcon.svelte";

	interface Props {
		presets: PresetIndex;
		geometry: PresetGeometry;
		/** The feature's type, marked in the list. */
		current: Preset | undefined;
		/** Ids of the types chosen last for this geometry, newest first. */
		recent: readonly string[];
		onchoose: (preset: Preset) => void;
		/** Escape: back to the editor without a change. */
		oncancel: () => void;
	}

	let { presets, geometry, current, recent, onchoose, oncancel }: Props =
		$props();

	let query = $state("");
	/** The highlighted row's value: a preset or category id, `category>preset` for a member. */
	let highlighted = $state("");
	const expanded = new SvelteSet<string>();

	const searching = $derived(query.trim() !== "");
	const items = $derived(
		searching
			? presets.search(query, geometry)
			: presets.listFor(geometry, recent, current),
	);

	const isCategory = (item: Preset | PresetCategory): item is PresetCategory =>
		"members" in item;
	const membersOf = (category: PresetCategory) =>
		category.members.filter((p) => p.geometry.includes(geometry));
	const memberValue = (category: PresetCategory, preset: Preset) =>
		`${category.id}>${preset.id}`;

	function toggle(category: PresetCategory) {
		if (expanded.has(category.id)) expanded.delete(category.id);
		else expanded.add(category.id);
	}

	/** iD's list keys: → opens the highlighted category, ← closes it from it or a member. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			oncancel();
			return;
		}
		// The arrows move the caret in a search; the list has no categories then.
		if (searching) return;
		const [categoryId, member] = highlighted.split(">");
		if (!categoryId || !items.some((i) => i.id === categoryId && isCategory(i)))
			return;
		if (event.key === "ArrowRight" && !member) {
			event.preventDefault();
			expanded.add(categoryId);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			expanded.delete(categoryId);
			highlighted = categoryId;
		}
	}
</script>

{#snippet presetRow(
	preset: Preset,
	value: string,
	member: "open" | "closed" | null,
)}
	<Command.Item
		{value}
		aria-current={preset === current ? "true" : undefined}
		data-checked={preset === current}
		disabled={member === "closed"}
		class={[member && "pl-8", member === "closed" && "hidden"]}
		onSelect={() => onchoose(preset)}
	>
		<PresetIcon icon={preset.icon} size={16} />
		<span class="truncate">{preset.name}</span>
	</Command.Item>
{/snippet}

<Command.Root
	shouldFilter={false}
	label="Search feature types"
	bind:value={highlighted}
	class="min-h-0 flex-1 rounded-none!"
>
	<Command.Input
		bind:value={query}
		placeholder="Search feature types"
		autocomplete="off"
		{onkeydown}
		{@attach (input) => input.focus()}
	/>
	<Command.List class="max-h-none flex-1">
		<Command.Empty>No feature type found</Command.Empty>
		<Command.Group>
			{#each items as item (item.id)}
				{#if isCategory(item)}
					{@const open = expanded.has(item.id)}
					<Command.Item
						value={item.id}
						aria-expanded={open}
						class="[&>svg:last-child]:hidden"
						onSelect={() => toggle(item)}
					>
						<PresetIcon icon={item.icon} size={16} />
						<span class="truncate">{item.name}</span>
						<ChevronRight
							class={[
								"ml-auto text-muted-foreground transition-transform",
								open && "rotate-90",
							]}
						/>
					</Command.Item>
					<!-- Members stay in the list while closed: the list highlights its first row
					     whenever rows are added. -->
					{#each membersOf(item) as member (member.id)}
						{@render presetRow(
							member,
							memberValue(item, member),
							open ? "open" : "closed",
						)}
					{/each}
				{:else}
					{@render presetRow(item, item.id, null)}
				{/if}
			{/each}
		</Command.Group>
	</Command.List>
</Command.Root>
