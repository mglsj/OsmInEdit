<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import FileImage from "@lucide/svelte/icons/file-image";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Upload from "@lucide/svelte/icons/upload";
	import type { Attachment } from "svelte/attachments";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Card from "#lib/components/shadcn/card/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import {
		ACCEPTED_FILES,
		importRaster,
		importSvg,
		kindOf,
		openPdf,
		type PdfDocument,
		planName,
	} from "#lib/floorplans/import.ts";
	import type { FloorPlans, View } from "#lib/state/floorplans.svelte.ts";
	import PdfPageDialog from "#lib/ui/PdfPageDialog.svelte";

	interface Props {
		floorplans: FloorPlans;
		/** The visible map, where new plans are placed. */
		getView: () => View | undefined;
		/** The level shown, which new plans are assigned to. */
		level: number;
	}

	let { floorplans, getView, level }: Props = $props();

	let open = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let pdf = $state.raw<{ document: PdfDocument; name: string } | null>(null);
	let input = $state<HTMLInputElement>();

	const selected = $derived(floorplans.selected);

	async function onFileChange(
		event: Event & { currentTarget: HTMLInputElement },
	) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!file) return;
		error = null;
		busy = true;
		try {
			const name = planName(file);
			switch (kindOf(file)) {
				case "raster":
					add(await importRaster(file), name);
					break;
				case "svg":
					add(await importSvg(file), name);
					break;
				case "pdf":
					pdf = { document: await openPdf(file), name };
					break;
				default:
					error = "IndoorID can import PNG, JPEG, WebP, SVG and PDF plans.";
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function add(image: Parameters<FloorPlans["add"]>[0], name: string) {
		const view = getView();
		if (!view) throw new Error("The map is not ready yet.");
		floorplans.add(image, name, view, String(level));
	}

	async function importPdfPage(page: number, dpi: number) {
		if (!pdf) return;
		const { document, name } = pdf;
		try {
			add(
				await document.render(page, dpi),
				document.pageCount > 1 ? `${name}, page ${page}` : name,
			);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function closePdf() {
		pdf?.document.close();
		pdf = null;
	}

	/** Shows a plan's image, through an object URL freed with the element. */
	function thumbnail(blob: Blob): Attachment<HTMLImageElement> {
		return (img) => {
			const url = URL.createObjectURL(blob);
			img.src = url;
			return () => URL.revokeObjectURL(url);
		};
	}
</script>

<div class="rounded-md bg-background shadow-md">
	<Button variant="outline" aria-expanded={open} onclick={() => (open = !open)}>
		<FileImage data-icon="inline-start" />
		Floor plans
	</Button>
</div>

{#if open}
	<Card.Root size="sm" class="w-80 max-w-[calc(100vw-2rem)] shadow-md">
		<Card.Header>
			<Card.Title>Floor plans</Card.Title>
			<Card.Description>
				PNG, JPEG, WebP, SVG or PDF. Plans are drawn under the indoor data.
			</Card.Description>
			<Card.Action>
				<Button size="sm" disabled={busy} onclick={() => input?.click()}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{:else}
						<Upload data-icon="inline-start" />
					{/if}
					Import
				</Button>
				<input
					bind:this={input}
					type="file"
					accept={ACCEPTED_FILES}
					aria-label="Import a floor plan"
					class="sr-only"
					tabindex="-1"
					onchange={onFileChange}
				>
			</Card.Action>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if error}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			{#if floorplans.plans.length === 0}
				<p class="text-sm text-muted-foreground">No floor plan yet.</p>
			{:else}
				<ul aria-label="Floor plans" class="flex flex-col gap-1">
					{#each floorplans.plans as plan (plan.id)}
						<li class="flex items-center gap-2">
							<button
								type="button"
								class={[
									"flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left text-sm hover:bg-muted",
									plan.id === floorplans.selectedId && "bg-muted",
								]}
								aria-current={plan.id === floorplans.selectedId}
								onclick={() => (floorplans.selectedId = plan.id)}
							>
								<img
									{@attach thumbnail(plan.image.blob)}
									alt=""
									class="size-10 shrink-0 rounded-sm border object-contain"
								>
								<span class="min-w-0">
									<span class="block truncate font-medium">{plan.name}</span>
									{" "}
									<span class="block text-xs text-muted-foreground"
										>{plan.image.width}
										× {plan.image.height} px</span
									>
								</span>
							</button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Show ${plan.name}`}
								aria-pressed={plan.visible}
								onclick={() =>
									floorplans.update(plan.id, { visible: !plan.visible })}
							>
								{#if plan.visible}
									<Eye />
								{:else}
									<EyeOff />
								{/if}
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove ${plan.name}`}
								onclick={() => floorplans.remove(plan.id)}
							>
								<Trash2 />
							</Button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if selected}
				<Field.Field>
					<Field.Label for="plan-opacity">Opacity</Field.Label>
					<Slider
						id="plan-opacity"
						type="single"
						min={0}
						max={1}
						step={0.05}
						value={selected.opacity}
						onValueChange={(opacity: number) =>
							floorplans.update(selected.id, { opacity })}
					/>
				</Field.Field>
			{/if}
		</Card.Content>
	</Card.Root>
{/if}

{#if pdf}
	<PdfPageDialog
		pdf={pdf.document}
		onimport={importPdfPage}
		onclose={closePdf}
	/>
{/if}
