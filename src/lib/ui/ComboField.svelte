<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import {
		type ComboSuggestion,
		comboSuggestions,
		displayValue,
		type SuggestedValue,
		tagValue,
	} from "#lib/presets/combo.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { type FieldContext, fieldInputId } from "#lib/ui/field-context.ts";
	import { liveText } from "#lib/ui/live-text.ts";
	import { cn } from "#lib/utils.ts";

	interface Props {
		field: Field;
		/** The tag value (combo, typeCombo, networkCombo). */
		value: string | undefined;
		context: FieldContext;
		locked: boolean;
		/** Called with the new value once accepted (Enter, Tab, a click, leaving the field). */
		onchange?: (value: string | undefined) => void;
		/**
		 * The input of a chip list instead: what is accepted goes to `onadd` (as typed) and the
		 * input empties; values in `chosen` aren't offered again.
		 */
		adding?: {
			readonly chosen: readonly string[];
			readonly onadd: (typed: string) => void;
		};
		/** Free text (an address), never shown as a raw tag value. */
		plain?: boolean;
		/**
		 * Text kept as typed (only trimmed), suggestions asked for without a key: the tag
		 * table's key and value inputs. Implies `plain`.
		 */
		raw?: boolean;
		/** The input's name when no label points at it. */
		ariaLabel?: string;
		/**
		 * Text applied while it is typed (an address part, as iD), without the completion
		 * offered after it; leaving the field then calls `onchange`, even with the same text.
		 */
		onlive?: (typed: string) => void;
	}

	let {
		field,
		value,
		context,
		locked,
		onchange,
		adding,
		plain: plainProp = false,
		raw = false,
		ariaLabel,
		onlive,
	}: Props = $props();

	const id = $derived(fieldInputId(field));
	const listId = $derived(`${id}-list`);
	const readonly = $derived(locked || !field.customValues);

	let input = $state<HTMLInputElement>();
	let wrap = $state<HTMLDivElement>();
	let open = $state(false);
	/** What the suggestions are for: the text typed, or "" for all of them. */
	let query = $state("");
	let suggested = $state.raw<readonly SuggestedValue[] | null>(null);
	let highlighted = $state(-1);
	/** Whether the user typed or chose something since the field got focus. */
	let dirty = false;
	let pending: ReturnType<typeof setTimeout> | undefined;
	/** The query taginfo was last asked about: older answers are dropped. */
	let asked = "";

	const suggestions = $derived(
		comboSuggestions(field, query, suggested, {
			deprecated: field.key ? context.deprecated(field.key) : [],
			chosen: adding?.chosen ?? [],
		}),
	);
	const plain = $derived(plainProp || raw);
	const shown = $derived(
		adding ? "" : raw ? (value ?? "") : displayValue(field, value),
	);
	/** iD asks taginfo for every combo but manyCombo, unless the field says not to. */
	const asksTaginfo = $derived(
		context.suggest !== undefined &&
			field.autoSuggestions &&
			field.type !== "manyCombo" &&
			(raw || field.key !== undefined),
	);
	const hasList = $derived(
		!locked && (field.options.length > 0 || asksTaginfo),
	);

	/** Asks taginfo for values matching `q`, after a pause while typing (as iD). */
	function fetchValues(q: string) {
		clearTimeout(pending);
		const suggest = context.suggest;
		if (!suggest || !asksTaginfo) return;
		asked = q;
		const run = () =>
			suggest(field, q)
				.then((values) => {
					if (asked !== q) return;
					suggested = values;
					if (open) autocomplete();
				})
				.catch(() => {});
		if (q) pending = setTimeout(run, 300);
		else run();
	}

	/** The text typed, without the completion selected after it. */
	function typed(): string {
		if (!input) return "";
		const { value: text, selectionStart, selectionEnd } = input;
		return selectionStart && selectionEnd && selectionStart !== selectionEnd
			? text.slice(0, selectionStart)
			: text;
	}

	/** iD's inline completion: the first suggestion starting with what was typed, the rest selected. */
	function autocomplete() {
		if (!input || document.activeElement !== input || readonly) return;
		if (input.selectionEnd !== input.value.length) return;
		const text = typed();
		const compare = (s: string) => (field.caseSensitive ? s : s.toLowerCase());
		const wanted = compare(text);
		if (!wanted || Number.isFinite(Number(wanted))) return;
		const candidates = suggestions.flatMap((s) =>
			s.label !== s.value ? [s.label, s.value] : [s.label],
		);
		const best =
			candidates.find((c) => compare(c) === wanted) ??
			candidates.find((c) => compare(c).startsWith(wanted));
		if (best === undefined) return;
		input.value = best;
		input.setSelectionRange(text.length, best.length, "backward");
		highlighted = suggestions.findIndex(
			(s) => s.label === best || s.value === best,
		);
	}

	/** Whether text was applied while typing since the field got focus. */
	let appliedLive = false;
	const live = liveText(() => {
		if (!onlive || !input || adding) return;
		appliedLive = true;
		onlive(typed());
	});

	function oninput(event: Event) {
		if (!input) return;
		dirty = true;
		const text = input.value;
		live.typed(text);
		query = text;
		highlighted = -1;
		open = text !== "";
		fetchValues(text);
		const { inputType, isComposing } = event as InputEvent;
		if (!inputType?.startsWith("delete") && !isComposing) autocomplete();
	}

	function onfocus() {
		dirty = false;
		query = "";
		fetchValues("");
	}

	function commit() {
		live.cancel();
		if (!input || !dirty) return;
		dirty = false;
		const closesLive = appliedLive;
		appliedLive = false;
		if (adding) {
			const text = input.value.trim();
			input.value = "";
			query = "";
			if (text) adding.onadd(text);
			return;
		}
		const next = raw
			? input.value.trim() || undefined
			: tagValue(field, input.value);
		input.value = raw ? (next ?? "") : displayValue(field, next);
		if (next !== value || closesLive) onchange?.(next);
	}

	function accept() {
		open = false;
		if (input) input.setSelectionRange(input.value.length, input.value.length);
		commit();
	}

	function choose(suggestion: ComboSuggestion) {
		if (!input) return;
		input.value = suggestion.label;
		dirty = true;
		accept();
	}

	function showAll() {
		if (locked) return;
		input?.focus();
		query = "";
		highlighted = suggestions.findIndex((s) => s.value === value);
		open = !open;
	}

	function move(step: number) {
		if (!input) return;
		// Opened even before taginfo answers: the list shows once it does (as iD).
		if (!open) {
			if (!input.value) query = "";
			open = true;
		}
		if (suggestions.length === 0) return;
		const current =
			highlighted >= 0
				? highlighted
				: suggestions.findIndex(
						(s) => s.label === input?.value || s.value === input?.value,
					);
		highlighted = Math.max(0, Math.min(current + step, suggestions.length - 1));
		const suggestion = suggestions[highlighted] as ComboSuggestion;
		input.value = suggestion.label;
		dirty = true;
		document
			.getElementById(`${listId}-${highlighted}`)
			?.scrollIntoView({ block: "nearest" });
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				if (locked) return;
				event.preventDefault();
				move(event.key === "ArrowDown" ? 1 : -1);
				break;
			case "Enter":
				event.preventDefault();
				event.stopPropagation();
				accept();
				break;
			case "Tab":
				accept();
				break;
			case "Escape":
				if (open) {
					event.stopPropagation();
					open = false;
				}
				break;
			case "Backspace":
			case "Delete":
				// A fixed list's value can't be typed over: these keys take it off (as iD).
				if (readonly && !locked && !adding && value !== undefined) {
					event.preventDefault();
					open = false;
					onchange?.(undefined);
				}
				break;
		}
	}

	const tagText = (v: string) => (field.key && !raw ? `${field.key}=${v}` : v);
</script>

<div bind:this={wrap} class="relative">
	<input
		bind:this={input}
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-autocomplete="both"
		aria-label={ariaLabel}
		aria-expanded={open && suggestions.length > 0}
		aria-controls={listId}
		aria-activedescendant={open && highlighted >= 0
			? `${listId}-${highlighted}`
			: undefined}
		value={shown}
		placeholder={field.placeholder ??
			(adding ? "Add…" : undefined) ??
			suggestions
				.slice(0, 3)
				.map((s) => s.label)
				.join(", ") + (suggestions.length ? "…" : "")}
		title={value ? tagText(value) : undefined}
		{readonly}
		class={cn(
			"flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pl-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
			raw ? "pr-2.5" : "pr-8",
			!plain &&
				value !== undefined &&
				!field.options.some((o) => o.value === value) &&
				"font-mono text-xs",
		)}
		{oninput}
		{onfocus}
		{onkeydown}
		onclick={() => {
			if (readonly) showAll();
		}}
		onblur={() => {
			open = false;
			commit();
		}}
	>
	<!-- No caret in the tag table, as iD: ↓ opens the list. -->
	{#if hasList && !raw}
		<button
			type="button"
			tabindex="-1"
			aria-label={`Show values for ${field.label}`}
			class="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
			onmousedown={(event) => event.preventDefault()}
			onclick={showAll}
		>
			<ChevronDown class="size-4" />
		</button>
	{/if}
</div>

<Popover.Root
	open={open && suggestions.length > 0}
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
		class="max-h-64 w-(--bits-popover-anchor-width) gap-0 overflow-y-auto p-1"
	>
		<div id={listId} role="listbox" aria-label={field.label}>
			{#each suggestions as suggestion, i (suggestion.value)}
				<div
					id={`${listId}-${i}`}
					role="option"
					aria-selected={i === highlighted}
					tabindex="-1"
					title={[
						suggestion.description ?? suggestion.title,
						tagText(suggestion.value),
					]
						.filter(Boolean)
						.join("\n")}
					class={[
						"flex cursor-default flex-col rounded-sm px-2 py-1.5 text-sm",
						i === highlighted ? "bg-muted" : "hover:bg-muted/60",
					]}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => choose(suggestion)}
					onkeydown={() => {}}
				>
					<span class={[!plain && suggestion.raw && "font-mono text-xs"]}
						>{suggestion.label}</span
					>
					{#if suggestion.description}
						<span class="text-xs text-muted-foreground"
							>{suggestion.description}</span
						>
					{/if}
				</div>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
