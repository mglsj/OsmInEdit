<script lang="ts">
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import type { PdfDocument } from "#lib/floorplans/import.ts";

	interface Props {
		pdf: PdfDocument;
		/** Called with the chosen page (from 1) and resolution; resolves once imported. */
		onimport: (page: number, dpi: number) => Promise<void>;
		onclose: () => void;
	}

	let { pdf, onimport, onclose }: Props = $props();

	const pages = $derived(
		Array.from({ length: pdf.pageCount }, (_, i) => i + 1),
	);
	let open = $state(true);
	let page = $state("1");
	let dpi = $state(150);
	let busy = $state(false);
	let thumbnails = $state<Record<number, string>>({});
	let size = $state<{ width: number; height: number } | null>(null);

	// Thumbnails render one after the other, in the background, and stop once a page is being
	// imported (which waits for pdf.js) or the dialog closes (which ends the document).
	$effect(() => {
		let cancelled = false;
		void (async () => {
			for (const n of pages) {
				if (cancelled || busy) return;
				const url = await pdf.thumbnail(n).catch(() => null);
				if (cancelled || url === null) return;
				thumbnails = { ...thumbnails, [n]: url };
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const n = Number(page);
		void pdf.pageSize(n).then((inches) => {
			if (Number(page) === n) size = inches;
		});
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		try {
			await onimport(Number(page), dpi);
			open = false;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChangeComplete={(isOpen) => {
		if (!isOpen) onclose();
	}}
>
	<Dialog.Content
		showCloseButton={false}
		escapeKeydownBehavior={busy ? "ignore" : "close"}
		interactOutsideBehavior={busy ? "ignore" : "close"}
	>
		<Dialog.Header>
			<Dialog.Title>Import a PDF page</Dialog.Title>
			<Dialog.Description>
				Choose the page with the floor plan, and how finely to render it.
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-6" onsubmit={submit}>
			<Field.Set>
				<Field.Legend class="sr-only">Page</Field.Legend>
				<ScrollArea class="*:data-[slot=scroll-area-viewport]:max-h-72">
					<RadioGroup.Root bind:value={page} class="grid grid-cols-3 gap-3">
						{#each pages as n (n)}
							{@const id = `pdf-page-${n}`}
							<Field.Label
								for={id}
								class="flex-col items-center gap-2 rounded-md border p-2 has-data-checked:border-primary"
							>
								{#if thumbnails[n]}
									<img
										src={thumbnails[n]}
										alt=""
										class="h-24 w-full object-contain"
									>
								{:else}
									<span class="flex h-24 items-center"><Spinner /></span>
								{/if}
								<span class="flex items-center gap-2">
									<RadioGroup.Item value={String(n)} {id} />
									Page {n}
								</span>
							</Field.Label>
						{/each}
					</RadioGroup.Root>
				</ScrollArea>
			</Field.Set>
			<Field.Field>
				<Field.Label for="pdf-dpi">Resolution (DPI)</Field.Label>
				<Input
					id="pdf-dpi"
					type="number"
					min={36}
					max={600}
					step={1}
					required
					bind:value={dpi}
				/>
				{#if size && dpi > 0}
					<Field.Description>
						{Math.round(size.width * dpi)}
						×
						{Math.round(size.height * dpi)}
						px. Higher shows more detail but takes more memory.
					</Field.Description>
				{/if}
			</Field.Field>
			<Dialog.Footer>
				<Button
					variant="outline"
					disabled={busy}
					onclick={() => (open = false)}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={busy}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{/if}
					Import
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
