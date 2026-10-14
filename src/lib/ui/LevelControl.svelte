<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { Tooltip } from 'bits-ui';

	interface Props {
		level: number;
	}

	// Until building data is loaded (phase 2), levels simply step by one.
	let { level = $bindable() }: Props = $props();

	const buttons = [
		{ label: 'Level up', step: 1, Icon: ChevronUp },
		{ label: 'Level down', step: -1, Icon: ChevronDown }
	];
</script>

<Tooltip.Provider delayDuration={300}>
	<div
		class="flex flex-col items-center overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/15"
	>
		{#each buttons as { label, step, Icon }, i (label)}
			{#if i === 1}
				<output
					class="w-10 border-y border-black/10 py-1 text-center text-sm font-semibold tabular-nums dark:border-white/15"
					aria-label="Current level"
					data-testid="level"
				>
					{level}
				</output>
			{/if}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="flex h-9 w-10 items-center justify-center hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:bg-slate-800"
					aria-label={label}
					onclick={() => (level += step)}
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
		{/each}
	</div>
</Tooltip.Provider>
