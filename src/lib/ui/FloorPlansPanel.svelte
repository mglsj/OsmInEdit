<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Download from "@lucide/svelte/icons/download";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import Info from "@lucide/svelte/icons/info";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Upload from "@lucide/svelte/icons/upload";
	import X from "@lucide/svelte/icons/x";
	import type { Attachment } from "svelte/attachments";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Separator } from "#lib/components/shadcn/separator/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import type { TransformKind } from "#lib/floorplans/georef.ts";
	import {
		ACCEPTED_FILES,
		importRaster,
		importSvg,
		kindOf,
		openPdf,
		type PdfDocument,
		planName,
	} from "#lib/floorplans/import.ts";
	import {
		exportPlans,
		parsePlansFile,
		transformOf,
	} from "#lib/floorplans/plan-file.ts";
	import {
		type FloorPlans,
		MIN_POINTS,
		type Tool,
		type View,
	} from "#lib/state/floorplans.svelte.ts";
	import PdfPageDialog from "#lib/ui/PdfPageDialog.svelte";

	interface Props {
		floorplans: FloorPlans;
		/** The visible map, where new plans are placed. */
		getView: () => View | undefined;
		/** The level shown, which new plans are assigned to. */
		level: number;
		/** Why the alignment tool ignored the last map click, if it did. */
		toolMessage?: string | null;
		/** Leaves floor plan mode. */
		onclose: () => void;
	}

	let {
		floorplans,
		getView,
		level,
		toolMessage = null,
		onclose,
	}: Props = $props();

	let distance = $state<number>();
	let angle = $state<number>(90);

	const tool = $derived(floorplans.tool);
	const fit = $derived(floorplans.fit);
	const hint = $derived.by(() => {
		switch (tool?.kind) {
			case "points":
				return tool.pending
					? "Now click where that spot is on the map. Clicks near an OSM node snap to it."
					: "Click a spot on the plan, such as a corner, then where it is on the map.";
			case "measure":
				return tool.points.length < 2
					? "Click two spots on the plan whose real distance you know."
					: "Give the real distance between the two spots.";
			case "rotate":
				return tool.pin
					? "Turn the plan around the picked spot."
					: "Click the spot on the plan to turn around.";
			default:
				return "Drag the plan to move it, a corner to resize it, the round handle above it to turn it. While dragging a corner: Shift stretches, Ctrl (⌘) resizes from the centre, Alt moves that corner alone. Shift turns in 15° steps. For precise placement, pick a tool.";
		}
	});
	const FIT_KINDS: { kind: TransformKind; label: string }[] = [
		{ kind: "similarity", label: "Similarity" },
		{ kind: "affine", label: "Affine" },
		{ kind: "projective", label: "Perspective" },
	];

	function scale(event: SubmitEvent) {
		event.preventDefault();
		if (distance && distance > 0) floorplans.scaleTo(distance);
	}

	function rotate(event: SubmitEvent) {
		event.preventDefault();
		if (Number.isFinite(angle)) floorplans.rotate(angle);
	}

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
				case "plans":
					await importPlansFile(file);
					break;
				default:
					error =
						"IndoorID can import PNG, JPEG, WebP, SVG and PDF plans, and plan files (.json).";
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

	/** Adds the plans of an IndoorID or OsmInEdit 1.x plan file, placed as saved. */
	async function importPlansFile(file: File) {
		for (const entry of parsePlansFile(await file.text())) {
			const blob = await (await fetch(entry.image)).blob();
			const image =
				blob.type === "image/svg+xml"
					? await importSvg(blob)
					: await importRaster(blob);
			floorplans.insert({
				name: entry.name,
				image,
				transform: transformOf(entry, image.width, image.height),
				controlPoints: entry.controlPoints,
				fitKind:
					"transform" in entry.placement
						? entry.placement.transform.kind
						: "projective",
				opacity: entry.opacity,
				level: entry.level,
				visible: entry.visible,
			});
		}
	}

	/** Downloads every plan, images included, as an IndoorID plan file. */
	async function exportFile() {
		const entries = await Promise.all(
			floorplans.plans.map(async (plan) => ({
				name: plan.name,
				image: await dataUrl(plan.image.blob),
				width: plan.image.width,
				height: plan.image.height,
				level: plan.level,
				opacity: plan.opacity,
				visible: plan.visible,
				placement: { transform: plan.transform },
				controlPoints: plan.controlPoints,
			})),
		);
		const url = URL.createObjectURL(
			new Blob([exportPlans(entries)], { type: "application/json" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = "indoorid-floorplans.json";
		link.click();
		URL.revokeObjectURL(url);
	}

	function dataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
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

<aside
	aria-label="Floor plan editor"
	class="flex h-full w-88 max-w-[calc(100vw-2rem)] flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-start gap-2 px-4 py-3">
		<div class="min-w-0 flex-1">
			<h2 class="text-base font-semibold">Floor plans</h2>
			<p class="text-sm text-muted-foreground">
				Place plans against the building outlines. Import PNG, JPEG, WebP, SVG
				or PDF.
			</p>
		</div>
		<Button size="sm" onclick={onclose}>Done</Button>
	</header>
	<Separator />
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-4 p-4">
			<div class="flex gap-2">
				<Button size="sm" disabled={busy} onclick={() => input?.click()}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{:else}
						<Upload data-icon="inline-start" />
					{/if}
					Import
				</Button>
				{#if floorplans.plans.length > 0}
					<Button
						size="icon-sm"
						variant="outline"
						aria-label="Export floor plans"
						onclick={exportFile}
					>
						<Download />
					</Button>
				{/if}
				<input
					bind:this={input}
					type="file"
					accept={ACCEPTED_FILES}
					aria-label="Import a floor plan"
					class="sr-only"
					tabindex="-1"
					onchange={onFileChange}
				>
			</div>
			{#if error}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}
			{#if floorplans.storageError}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{floorplans.storageError}</Alert.Description>
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
								onclick={() => floorplans.select(plan.id)}
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
					<Field.Label for="plan-level">Level</Field.Label>
					<Input
						id="plan-level"
						type="text"
						autocomplete="off"
						placeholder="Every level"
						value={selected.level ?? ""}
						onchange={(event) =>
							floorplans.update(selected.id, {
								level: event.currentTarget.value.trim() || null,
							})}
					/>
					<Field.Description>
						The plan only shows on this level, like 0 or -1.
					</Field.Description>
				</Field.Field>

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

				<Field.Field>
					<Field.Label id="plan-tool-label">Align</Field.Label>
					<ToggleGroup.Root
						type="single"
						variant="outline"
						size="sm"
						aria-labelledby="plan-tool-label"
						class="w-full"
						value={tool?.kind ?? ""}
						onValueChange={(kind) =>
							floorplans.setTool((kind || null) as Tool["kind"] | null)}
					>
						<ToggleGroup.Item value="points" class="flex-1"
							>Control points
						</ToggleGroup.Item>
						<ToggleGroup.Item value="measure" class="flex-1"
							>Measure
						</ToggleGroup.Item>
						<ToggleGroup.Item value="rotate" class="flex-1"
							>Rotate
						</ToggleGroup.Item>
					</ToggleGroup.Root>
					<Field.Description>{hint}</Field.Description>
				</Field.Field>

				{#if toolMessage && tool}
					<Alert.Root>
						<Info />
						<Alert.Description>{toolMessage}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if tool?.kind === "points"}
					{#if selected.controlPoints.length > 0}
						<ol aria-label="Control points" class="flex flex-col gap-1 text-sm">
							{#each selected.controlPoints as _, i (i)}
								<li class="flex items-center gap-2">
									<span class="w-5 text-muted-foreground tabular-nums"
										>{i + 1}</span
									>{" "}
									<span class="flex-1 tabular-nums">
										{fit
											? `${(fit.residuals[i] ?? 0).toFixed(2)} m`
											: "Moves the plan"}
									</span>
									<Button
										variant="ghost"
										size="icon-xs"
										aria-label={`Remove control point ${i + 1}`}
										onclick={() => floorplans.removeControlPoint(i)}
									>
										<X />
									</Button>
								</li>
							{/each}
						</ol>
					{/if}
					<Field.Field>
						<Field.Label id="plan-fit-label">Fit</Field.Label>
						<ToggleGroup.Root
							type="single"
							variant="outline"
							size="sm"
							aria-labelledby="plan-fit-label"
							class="w-full"
							value={selected.fitKind}
							onValueChange={(kind) => {
								if (kind) floorplans.setFitKind(kind as TransformKind);
							}}
						>
							{#each FIT_KINDS as { kind, label } (kind)}
								<ToggleGroup.Item value={kind} class="flex-1"
									>{label}</ToggleGroup.Item
								>
							{/each}
						</ToggleGroup.Root>
						<Field.Description>
							{#if selected.controlPoints.length < MIN_POINTS[selected.fitKind]}
								Needs {MIN_POINTS[selected.fitKind]} points; until then the plan
								keeps its shape.
							{:else if fit}
								RMS error {fit.rms.toFixed(2)} m
							{/if}
						</Field.Description>
					</Field.Field>
				{:else if tool?.kind === "measure" && tool.points.length === 2}
					<form class="flex items-end gap-2" onsubmit={scale}>
						<Field.Field>
							<Field.Label for="plan-distance">Real distance (m)</Field.Label>
							<Input
								id="plan-distance"
								type="number"
								min={0}
								step="any"
								required
								bind:value={distance}
							/>
						</Field.Field>
						<Button type="submit">Scale</Button>
					</form>
				{:else if tool?.kind === "rotate" && tool.pin}
					<form class="flex items-end gap-2" onsubmit={rotate}>
						<Field.Field>
							<Field.Label for="plan-angle">Angle (°, clockwise)</Field.Label>
							<Input
								id="plan-angle"
								type="number"
								step="any"
								required
								bind:value={angle}
							/>
						</Field.Field>
						<Button type="submit">Rotate</Button>
					</form>
				{/if}
			{/if}
		</div>
	</ScrollArea>
</aside>

{#if pdf}
	<PdfPageDialog
		pdf={pdf.document}
		onimport={importPdfPage}
		onclose={closePdf}
	/>
{/if}
