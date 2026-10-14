<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import { Tooltip } from "bits-ui";

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
</script>

{#snippet stepButton(
	label: string,
	Icon: typeof ChevronUp,
	target: number | undefined,
)}
	<Tooltip.Root>
		<Tooltip.Trigger
			class="flex h-9 w-10 items-center justify-center hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-30 dark:hover:bg-slate-800"
			aria-label={label}
			disabled={target === undefined}
			onclick={() => {
				if (target !== undefined) level = target;
			}}
		>
			<Icon size={18} aria-hidden="true" />
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				side="left"
				sideOffset={6}
				class="rounded bg-slate-900 px-2 py-1 text-xs text-white shadow dark:bg-slate-100 dark:text-slate-900"
			>
				{label}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
{/snippet}

<Tooltip.Provider delayDuration={300}>
	<div
		class="flex flex-col items-center overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15"
	>
		{@render stepButton("Level up", ChevronUp, upTarget)}
		<output
			class="w-10 border-y border-black/10 py-1 text-center text-sm font-semibold tabular-nums dark:border-white/15"
			aria-label="Current level"
			data-testid="level"
		>
			{level}
		</output>
		{#if descending.length > 0}
			<ul
				class="flex max-h-64 w-10 flex-col overflow-y-auto border-b border-black/10 dark:border-white/15"
				aria-label="Levels"
			>
				{#each descending as l (l)}
					<li>
						<button
							type="button"
							class={[
								"h-8 w-full text-sm tabular-nums hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800",
								l === level &&
									"bg-brand-500 font-semibold text-white hover:bg-brand-600",
							]}
							aria-pressed={l === level}
							aria-label={`Level ${l}`}
							onclick={() => (level = l)}
						>
							{l}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{@render stepButton("Level down", ChevronDown, downTarget)}
	</div>
</Tooltip.Provider>
