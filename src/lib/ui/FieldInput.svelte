<script lang="ts">
	import type { Field } from "#lib/presets/presets.ts";

	interface Props {
		field: Field;
		value: string | undefined;
		/** Called with the new value when the user commits it; "" removes the tag. */
		onchange: (value: string) => void;
	}

	let { field, value, onchange }: Props = $props();

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

	const inputClass =
		"w-full rounded border border-black/15 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-slate-900";
</script>

<div class="flex flex-col gap-1">
	<label
		for={id}
		class="text-xs font-medium text-slate-600 dark:text-slate-300"
	>
		{field.label}
	</label>
	{#if kind === "check" || kind === "select"}
		<select {id} class={inputClass} value={value ?? ""} onchange={commit}>
			<option value=""></option>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
			{#if value && !options.some((o) => o.value === value)}
				<option {value}>{value}</option>
			{/if}
		</select>
	{:else if kind === "textarea"}
		<textarea
			{id}
			class={inputClass}
			rows="3"
			value={value ?? ""}
			onchange={commit}
		></textarea>
	{:else}
		<input
			{id}
			class={inputClass}
			type="text"
			value={value ?? ""}
			placeholder={field.placeholder}
			list={kind === "combo" && options.length > 0
				? `${id}-options`
				: undefined}
			autocomplete="off"
			onchange={commit}
		>
		{#if kind === "combo" && options.length > 0}
			<datalist id={`${id}-options`}>
				{#each options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</datalist>
		{/if}
	{/if}
</div>
