<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";

	interface Props {
		level: number;
		/** Levels present in the data, sorted ascending. Without data, levels step by one. */
		levels?: readonly number[];
	}

	let { level = $bindable(), levels = [] }: Props = $props();

	const above = $derived(levels.find((l) => l > level));
	const below = $derived(levels.findLast((l) => l < level));
	const descending = $derived([...levels].reverse());

	const upTarget = $derived(levels.length > 0 ? above : level + 1);
	const downTarget = $derived(levels.length > 0 ? below : level - 1);

	const selectedValue = () => String(level);
	function selectLevel(value: string) {
		// Clicking the current level again would unselect it: keep it.
		if (value) level = Number(value);
	}
</script>

{#snippet stepButton(
	label: string,
	Icon: typeof ChevronUp,
	target: number | undefined,
)}
	<Tooltip.Root>
		<Tooltip.Trigger
			disabled={target === undefined}
			onclick={() => {
				if (target !== undefined) level = target;
			}}
		>
			{#snippet child({
				props,
			})}
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={label}
					disabled={target === undefined}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="left">{label}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<ButtonGroup.Root
	orientation="vertical"
	aria-label="Level"
	class="rounded-md bg-background shadow-md"
>
	{@render stepButton("Level up", ChevronUp, upTarget)}
	<ButtonGroup.Text class="justify-center px-0 tabular-nums">
		{#snippet child({
			props,
		})}
			<output {...props} aria-label="Current level" data-testid="level">
				{level}
			</output>
		{/snippet}
	</ButtonGroup.Text>
	{#if descending.length > 1}
		<ToggleGroup.Root
			type="single"
			orientation="vertical"
			variant="outline"
			aria-label="Levels"
			class="max-h-64 w-full overflow-y-auto"
			bind:value={selectedValue, selectLevel}
		>
			{#each descending as l (l)}
				<ToggleGroup.Item
					value={String(l)}
					aria-label={`Level ${l}`}
					class="tabular-nums"
				>
					{l}
				</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>
	{/if}
	{@render stepButton("Level down", ChevronDown, downTarget)}
</ButtonGroup.Root>
