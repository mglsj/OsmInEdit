<script lang="ts">
	import { changesetTags } from "#lib/api/changeset.ts";
	import { OsmApiError } from "#lib/api/osm-api.ts";
	import type { Editor } from "#lib/state/editor.svelte.ts";
	import type { Session } from "#lib/state/session.svelte.ts";

	interface Props {
		editor: Editor;
		session: Session;
		/** Names of the imagery used while editing. */
		imagery: readonly string[];
		/** OSM website, to link to the uploaded changeset. */
		websiteUrl: string;
		onclose: () => void;
	}

	let { editor, session, imagery, websiteUrl, onclose }: Props = $props();

	let comment = $state("");
	let source = $state("");
	let reviewRequested = $state(false);
	let phase = $state<
		| { kind: "form" }
		| { kind: "uploading" }
		| { kind: "done"; changesetId: number }
		| { kind: "error"; message: string }
	>({ kind: "form" });

	const issues = $derived(editor.editIssues);
	const busy = $derived(phase.kind === "uploading");

	async function upload(event: SubmitEvent) {
		event.preventDefault();
		phase = { kind: "uploading" };
		try {
			if (!session.loggedIn) await session.login();
			const changesetId = await editor.upload(
				changesetTags({ comment, source, imagery, reviewRequested }),
			);
			phase = { kind: "done", changesetId };
		} catch (error) {
			if (error instanceof OsmApiError && error.kind === "auth")
				session.logout();
			phase = { kind: "error", message: explain(error) };
		}
	}

	function explain(error: unknown): string {
		if (!(error instanceof OsmApiError)) return (error as Error).message;
		switch (error.kind) {
			case "conflict":
				return "Someone else changed the same data in the meantime. Your edits are kept: reload the area to get their changes, then upload again.";
			case "precondition":
				return "Some data you edited was deleted or changed on the server. Your edits are kept: reload the area and check them.";
			case "auth":
				return "OpenStreetMap refused your login. Log in again, then upload.";
			case "rate-limit":
				return "OpenStreetMap is limiting requests right now. Wait a moment and try again.";
			case "network":
				return "OpenStreetMap could not be reached. Check your connection and try again.";
			default:
				return error.message;
		}
	}
</script>

<dialog
	aria-labelledby="save-title"
	{@attach (dialog) => dialog.showModal()}
	{onclose}
	class="m-auto w-[32rem] max-w-[calc(100vw-2rem)] rounded-lg bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40 dark:bg-slate-900 dark:text-slate-100"
>
	<div class="flex flex-col gap-4 p-5">
		<h2 id="save-title" class="text-lg font-semibold">Upload your edits</h2>

		{#if phase.kind === "done"}
			<p role="status">
				Uploaded in
				<a
					class="text-brand-600 underline"
					href={`${websiteUrl.replace(/\/+$/, "")}/changeset/${phase.changesetId}`}
					target="_blank"
					rel="noopener"
					>changeset {phase.changesetId}</a
				>. Thank you!
			</p>
			<div class="flex justify-end">
				<button
					type="button"
					onclick={onclose}
					class="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
				>
					Close
				</button>
			</div>
		{:else}
			<p class="text-sm text-slate-600 dark:text-slate-300">
				{editor.editCount}
				feature{editor.editCount === 1 ? "" : "s"}
				changed.
			</p>

			{#if issues.length > 0}
				<section
					aria-label="Issues in your edits"
					class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
				>
					<p class="font-medium">Please check before uploading:</p>
					<ul class="mt-1 list-disc pl-5">
						{#each issues as issue (issue.id)}
							<li>{issue.message} ({issue.entityId})</li>
						{/each}
					</ul>
				</section>
			{/if}

			<form class="flex flex-col gap-3" onsubmit={upload}>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Comment</span>
					<textarea
						bind:value={comment}
						required
						rows="2"
						maxlength="255"
						placeholder="What did you change? e.g. Add room numbers on the 2nd floor"
						class="rounded border border-black/15 px-2 py-1 focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-slate-900"
					></textarea>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">Source</span>
					<input
						type="text"
						bind:value={source}
						placeholder="e.g. survey, floor plan"
						class="rounded border border-black/15 px-2 py-1 focus:border-brand-500 focus:outline-none dark:border-white/20 dark:bg-slate-900"
					>
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={reviewRequested}>
					Ask for someone to review my edits
				</label>

				<p class="text-xs text-slate-500 dark:text-slate-400">
					{#if !session.configured}
						Login is not configured for this IndoorID instance
						(oauth_client_id).
					{:else if session.loggedIn}
						Logged in{session.userName ? ` as ${session.userName}` : ""}.
						<button
							type="button"
							class="underline"
							onclick={() => session.logout()}
						>
							Log out
						</button>
					{:else}
						You will be asked to log in to OpenStreetMap.
					{/if}
				</p>

				{#if phase.kind === "error"}
					<p
						role="alert"
						class="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
					>
						{phase.message}
					</p>
				{/if}

				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={onclose}
						disabled={busy}
						class="rounded px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={busy || !session.configured}
						class="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
					>
						{busy ? "Uploading…" : "Upload"}
					</button>
				</div>
			</form>
		{/if}
	</div>
</dialog>
