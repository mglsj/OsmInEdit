<script lang="ts">
	import { loadConfig } from "#lib/config.ts";
	import EditorView from "#lib/ui/EditorView.svelte";

	const configPromise = loadConfig();
</script>

<div class="flex h-full flex-col">
	<header
		class="flex h-12 shrink-0 items-center gap-3 border-b border-black/10 px-4 dark:border-white/15"
	>
		<h1 class="text-base font-semibold">IndoorID</h1>
		<span class="text-xs text-slate-500 dark:text-slate-400"
			>2.0 preview · {__GIT_HASH__}</span
		>
	</header>

	<main class="relative min-h-0 flex-1">
		{#await configPromise}
			<p class="p-4 text-sm text-slate-500">Loading…</p>
		{:then config}
			<EditorView {config} />
		{:catch error}
			<p role="alert" class="p-4 text-sm text-red-700 dark:text-red-300">
				{error.message}
			</p>
		{/await}
	</main>
</div>
