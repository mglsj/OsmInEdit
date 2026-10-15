<script lang="ts" module>
	/** A search result: what it is (`Q19675`, `fr`), and how it reads. */
	export interface SearchItem {
		readonly key: string;
		readonly label: string;
		readonly description?: string;
		readonly title?: string;
	}
</script>

<script lang="ts">
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import { cn } from "#lib/utils.ts";

	interface Props {
		id: string;
		/** What the input shows when not typing. */
		value: string;
		placeholder?: string;
		/** The input's name when no label points at it. */
		ariaLabel?: string;
		/** The language of the text shown (for scripts and screen readers). */
		lang?: string;
		readonly?: boolean;
		/** Results for what was typed ("" when nothing was: the field picks a hint). */
		search: (
			query: string,
		) => Promise<readonly SearchItem[]> | readonly SearchItem[];
		/** A result chosen (click, Enter or Tab on a highlighted one). */
		onchoose: (item: SearchItem) => void;
		/** Text accepted without choosing a result (Enter, leaving the field), when typed. */
		oncommit?: (text: string) => void;
		class?: string;
	}

	let {
		id,
		value,
		placeholder,
		ariaLabel,
		lang,
		readonly = false,
		search,
		onchoose,
		oncommit,
		class: className,
	}: Props = $props();

	const listId = $derived(`${id}-list`);
	let input = $state<HTMLInputElement>();
	let wrap = $state<HTMLDivElement>();
	let open = $state(false);
	let items = $state.raw<readonly SearchItem[]>([]);
	let highlighted = $state(-1);
	/** Whether the text was typed since the field got focus. */
	let dirty = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	/** The last query asked: older answers are dropped. */
	let asked: string | null = null;

	/** Searches, after a pause while typing (as iD's services). */
	function find(query: string, wait: boolean) {
		clearTimeout(pending);
		asked = query;
		const run = async () => {
			try {
				const found = await search(query);
				if (asked !== query) return;
				items = found;
				highlighted = -1;
			} catch {
				if (asked === query) items = [];
			}
		};
		if (wait) pending = setTimeout(run, 300);
		else void run();
	}

	function choose(item: SearchItem) {
		dirty = false;
		open = false;
		onchoose(item);
		if (input) input.value = item.label;
	}

	function commit() {
		open = false;
		if (!input || !dirty) return;
		dirty = false;
		oncommit?.(input.value.trim());
		input.value = value;
	}

	function onkeydown(event: KeyboardEvent) {
		if (readonly) return;
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp": {
				event.preventDefault();
				if (!open) {
					open = true;
					find(dirty && input ? input.value : "", false);
					return;
				}
				const step = event.key === "ArrowDown" ? 1 : -1;
				highlighted = Math.max(
					0,
					Math.min(highlighted + step, items.length - 1),
				);
				document
					.getElementById(`${listId}-${highlighted}`)
					?.scrollIntoView({ block: "nearest" });
				break;
			}
			case "Enter":
			case "Tab": {
				const item = open ? items[highlighted] : undefined;
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
				}
				if (item) choose(item);
				else if (event.key === "Enter") commit();
				break;
			}
			case "Escape":
				if (open) {
					event.stopPropagation();
					open = false;
				}
				break;
		}
	}
</script>

<div bind:this={wrap} class={cn("min-w-0", className)}>
	<input
		bind:this={input}
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		dir="auto"
		{lang}
		aria-label={ariaLabel}
		aria-autocomplete="list"
		aria-expanded={open && items.length > 0}
		aria-controls={listId}
		aria-activedescendant={open && highlighted >= 0
			? `${listId}-${highlighted}`
			: undefined}
		{value}
		{placeholder}
		{readonly}
		class="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
		onfocus={(event) => {
			dirty = false;
			// As iD: the whole value is selected, ready to be replaced.
			event.currentTarget.select();
		}}
		oninput={(event) => {
			dirty = true;
			const text = event.currentTarget.value;
			open = text !== "";
			find(text, text !== "");
		}}
		{onkeydown}
		onblur={commit}
	>
</div>

<Popover.Root
	open={open && items.length > 0}
	onOpenChange={(next) => {
		if (!next) open = false;
	}}
>
	<Popover.Content
		customAnchor={wrap}
		side="bottom"
		align="start"
		trapFocus={false}
		onOpenAutoFocus={(event) => event.preventDefault()}
		onCloseAutoFocus={(event) => event.preventDefault()}
		onInteractOutside={(event) => {
			if (wrap?.contains(event.target as Node)) event.preventDefault();
		}}
		class="max-h-64 w-(--bits-popover-anchor-width) min-w-56 gap-0 overflow-y-auto p-1"
	>
		<div id={listId} role="listbox" aria-label={ariaLabel ?? placeholder}>
			{#each items as item, i (item.key)}
				<div
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === highlighted}
					tabindex="-1"
					title={item.title}
					class={[
						"flex cursor-default flex-col rounded-sm px-2 py-1.5 text-sm",
						i === highlighted ? "bg-muted" : "hover:bg-muted/60",
					]}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => choose(item)}
					onkeydown={() => {}}
				>
					<span>{item.label}</span>
					{#if item.description}
						<span class="text-xs text-muted-foreground"
							>{item.description}</span
						>
					{/if}
				</div>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
