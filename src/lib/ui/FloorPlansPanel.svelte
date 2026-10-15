<script lang="ts">
	import Building2 from "@lucide/svelte/icons/building-2";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Download from "@lucide/svelte/icons/download";
	import Eraser from "@lucide/svelte/icons/eraser";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import Info from "@lucide/svelte/icons/info";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Upload from "@lucide/svelte/icons/upload";
	import X from "@lucide/svelte/icons/x";
	import { tick } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import * as AlertDialog from "#lib/components/shadcn/alert-dialog/index.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Separator } from "#lib/components/shadcn/separator/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import { BUILDING_COLOR, PLAN_COLORS } from "#lib/floorplans/colors.ts";
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
		parsePlanFile,
		transformOf,
	} from "#lib/floorplans/plan-file.ts";
	import { levelToShow } from "#lib/levels/levels.ts";
	import {
		BUILDINGS,
		type FloorPlan,
		type FloorPlans,
		type LayerEntry,
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
		/** Switches the map to a level, to show a plan on it. */
		onshowlevel: (level: number) => void;
	}

	let {
		floorplans,
		getView,
		level,
		toolMessage = null,
		onclose,
		onshowlevel,
	}: Props = $props();

	let distance = $state<number>();
	let angle = $state<number>(90);

	const tool = $derived(floorplans.tool);
	/** Whether the plan has control points, or the tool a half-done pick, to clear. */
	const canClear = $derived.by(() => {
		if ((floorplans.editing?.controlPoints.length ?? 0) > 0) return true;
		switch (tool?.kind) {
			case "points":
				return tool.pending !== null;
			case "measure":
				return tool.points.length > 0;
			case "rotate":
				return tool.pin !== null;
			default:
				return false;
		}
	});
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

	/** The layer list, top first: the map draws the first row on top. */
	const rows = $derived([...floorplans.layers].reverse());
	/** The row being dragged by its grip (plan id or BUILDINGS), and where it would land. */
	let dragging = $state<string | null>(null);
	/** Row index the dragged row would be dropped before (`rows.length`: after the last). */
	let dropAt = $state<number | null>(null);

	function keyOf(row: LayerEntry): string {
		return row.kind === "plan" ? row.plan.id : BUILDINGS;
	}

	/** Moves the row `key` so it is shown at `row` in the list (0 = top). */
	async function moveRow(key: string, row: number) {
		floorplans.move(key, rows.length - 1 - row);
		// Keyed rows move with their grip, which keeps the focus for further Alt+arrows.
		await tick();
		document.querySelector<HTMLElement>(`[data-grip="${key}"]`)?.focus();
	}

	function drop() {
		const key = dragging;
		const at = dropAt;
		dragging = null;
		dropAt = null;
		if (key === null || at === null) return;
		const from = rows.findIndex((r) => keyOf(r) === key);
		void moveRow(key, at > from ? at - 1 : at);
	}

	function onGripKey(event: KeyboardEvent, key: string, row: number) {
		if (!event.altKey) return;
		if (event.key === "ArrowUp" && row > 0) {
			event.preventDefault();
			void moveRow(key, row - 1);
		} else if (event.key === "ArrowDown" && row < rows.length - 1) {
			event.preventDefault();
			void moveRow(key, row + 1);
		}
	}

	/** Shows the plan's level: its own, or with several, the shown one if it is among them. */
	function showLevelOf(plan: { readonly level: string | null }) {
		onshowlevel(levelToShow(plan.level, level));
	}

	/** The plan whose removal is being confirmed. */
	let removing = $state.raw<FloorPlan | null>(null);

	/** The plan whose colour palette is open. */
	let choosingColor = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let pdf = $state.raw<{ document: PdfDocument; name: string } | null>(null);
	let input = $state<HTMLInputElement>();

	/** The plan in Edit, whose settings and tools show. */
	const selected = $derived(floorplans.editing);

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

	/** Adds a plan in the middle of the view, on the level shown. */
	function add(image: Parameters<FloorPlans["add"]>[0], name: string) {
		const view = getView();
		if (!view) throw new Error("The map is not ready yet.");
		floorplans.add(image, name, view, String(level));
	}

	/** Each page becomes a plan, all in the same spot on the level shown. */
	async function importPdfPages(pages: number[], dpi: number) {
		if (!pdf) return;
		const { document, name } = pdf;
		try {
			for (const page of pages) {
				add(
					await document.render(page, dpi),
					document.pageCount > 1 ? `${name}, page ${page}` : name,
				);
			}
		} catch (e) {
			error = (e as Error).message;
		}
	}

	/** Adds the plans of an IndoorID or OsmInEdit 1.x plan file, placed as saved. */
	async function importPlansFile(file: File) {
		const { plans, buildings } = parsePlanFile(await file.text());
		const existing = floorplans.plans.length;
		for (const entry of plans) {
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
				...(entry.color ? { color: entry.color } : {}),
			});
		}
		// The outlines go where the file had them among its plans.
		if (buildings) {
			floorplans.move(
				BUILDINGS,
				existing + Math.min(buildings.below, plans.length),
			);
			floorplans.setBuildingsVisible(buildings.visible);
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
				color: plan.color,
				placement: { transform: plan.transform },
				controlPoints: plan.controlPoints,
			})),
		);
		const url = URL.createObjectURL(
			new Blob([exportPlans(entries, floorplans.buildings)], {
				type: "application/json",
			}),
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

{#snippet swatch(
	color: string,
)}
	<span
		data-slot="swatch"
		class="size-4 rounded-full ring-1 ring-foreground/20"
		style:background-color={color}
	></span>
{/snippet}

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
		<Button size="sm" variant="outline" onclick={onclose}>
			<X data-icon="inline-start" />
			Close
		</Button>
	</header>
	<Separator />
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-4 p-4">
			<div class="flex gap-2">
				<Button
					size="sm"
					disabled={busy}
					onclick={() => floorplans.whenSaved(() => input?.click())}
				>
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

			<ul aria-label="Layers" class="flex flex-col">
				{#each rows as row, i (keyOf(row))}
					{@const key = keyOf(row)}
					{@const editing =
						row.kind === "plan" && row.plan.id === floorplans.editingId}
					<li
						class={[
							"flex items-center gap-2 rounded-md border-y-2 border-transparent p-1",
							editing && "bg-muted",
							dropAt === i && "border-t-primary",
							dropAt === rows.length &&
								i === rows.length - 1 &&
								"border-b-primary",
						]}
						aria-current={editing}
						ondragover={(event) => {
							if (!dragging) return;
							event.preventDefault();
							const box = event.currentTarget.getBoundingClientRect();
							dropAt = event.clientY < box.top + box.height / 2 ? i : i + 1;
						}}
						ondrop={(event) => {
							event.preventDefault();
							drop();
						}}
					>
						<button
							type="button"
							draggable="true"
							data-grip={key}
							class="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-label={`Move ${row.kind === "plan" ? row.plan.name : "buildings"}`}
							title="Drag to reorder, or Alt+↑ / Alt+↓"
							ondragstart={(event) => {
								dragging = key;
								event.dataTransfer?.setData("text/plain", key);
								if (event.dataTransfer)
									event.dataTransfer.effectAllowed = "move";
							}}
							ondragend={() => {
								dragging = null;
								dropAt = null;
							}}
							onkeydown={(event) => onGripKey(event, key, i)}
						>
							<GripVertical class="size-4" />
						</button>
						{#if row.kind === "buildings"}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Show buildings"
								aria-pressed={floorplans.buildings.visible}
								onclick={() =>
									floorplans.setBuildingsVisible(!floorplans.buildings.visible)}
							>
								{#if floorplans.buildings.visible}
									<Eye />
								{:else}
									<EyeOff />
								{/if}
							</Button>
							<span class="flex size-6 shrink-0 items-center justify-center">
								{@render swatch(BUILDING_COLOR)}
							</span>
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-sm border"
							>
								<Building2 class="size-5 text-muted-foreground" />
							</span>
							<span class="min-w-0 flex-1 text-sm">
								<span class="block truncate font-medium">Buildings</span>
								{" "}
								<span class="block text-xs text-muted-foreground"
									>Outlines from OpenStreetMap</span
								>
							</span>
						{:else}
							{@const plan = row.plan}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Show ${plan.name}`}
								aria-pressed={plan.visible}
								onclick={() => floorplans.setVisible(plan.id, !plan.visible)}
							>
								{#if plan.visible}
									<Eye />
								{:else}
									<EyeOff />
								{/if}
							</Button>
							{#if editing}
								<Popover.Root
									open={choosingColor === plan.id}
									onOpenChange={(open) =>
										(choosingColor = open ? plan.id : null)}
								>
									<Popover.Trigger
										class="flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
										aria-label={`Colour of ${plan.name}`}
									>
										{@render swatch(plan.color)}
									</Popover.Trigger>
									<Popover.Content align="start" class="w-auto p-2">
										<fieldset class="grid grid-cols-4 gap-1">
											<legend class="sr-only">Colours for {plan.name}</legend>
											{#each PLAN_COLORS as color (color.value)}
												<button
													type="button"
													aria-label={color.name}
													title={color.name}
													aria-pressed={plan.color === color.value}
													class="flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-muted"
													onclick={() => {
														floorplans.update(plan.id, { color: color.value });
														choosingColor = null;
													}}
												>
													<span
														class="size-5 rounded-full ring-1 ring-foreground/20"
														style:background-color={color.value}
													></span>
												</button>
											{/each}
										</fieldset>
									</Popover.Content>
								</Popover.Root>
							{:else}
								<span class="flex size-6 shrink-0 items-center justify-center">
									{@render swatch(plan.color)}
								</span>
							{/if}
							{#if editing}
								<img
									{@attach thumbnail(plan.image.blob)}
									alt=""
									class="size-10 shrink-0 rounded-sm border object-contain"
								>
								<span class="min-w-0 flex-1 text-sm">
									<Input
										aria-label="Name"
										autocomplete="off"
										class="h-7 px-2 font-medium"
										value={plan.name}
										onchange={(event) => {
											const name = event.currentTarget.value.trim();
											if (name) floorplans.update(plan.id, { name });
											else event.currentTarget.value = plan.name;
										}}
									/>
									<span
										class="mt-0.5 block truncate text-xs text-muted-foreground"
										>{plan.image.width}
										× {plan.image.height} px</span
									>
								</span>
							{:else}
								<!-- The row itself: shows the plan's level. -->
								<button
									type="button"
									class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
									title="Show this plan's level"
									onclick={() => showLevelOf(plan)}
								>
									<img
										{@attach thumbnail(plan.image.blob)}
										alt=""
										class="size-10 shrink-0 rounded-sm border object-contain"
									>
									<span class="min-w-0 flex-1 text-sm">
										<span class="block truncate font-medium">{plan.name}</span>
										{" "}
										<span class="block truncate text-xs text-muted-foreground"
											>{plan.image.width}
											× {plan.image.height} px</span
										>
									</span>
								</button>
							{/if}
							<Badge
								variant="outline"
								class="shrink-0 tabular-nums"
								title="Level the plan shows on"
							>
								<span class="sr-only">Level</span>
								{plan.level ?? "All"}
							</Badge>
							{#if !editing}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Edit ${plan.name}`}
									onclick={() =>
										floorplans.whenSaved(() => {
											floorplans.edit(plan.id);
											showLevelOf(plan);
										})}
								>
									<Pencil />
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="icon-sm"
								class="text-destructive hover:text-destructive"
								aria-label={`Remove ${plan.name}`}
								onclick={() => (removing = plan)}
							>
								<Trash2 />
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
			{#if floorplans.plans.length === 0}
				<p class="text-sm text-muted-foreground">No floor plan yet.</p>
			{:else if !selected}
				<p class="text-sm text-muted-foreground">
					Plans are locked: press Edit on one to move, align or change it.
				</p>
			{/if}

			{#if selected}
				<section
					aria-label={`Editing ${selected.name}`}
					class="flex flex-col gap-4 rounded-md border p-3"
				>
					<div class="flex items-center gap-2">
						<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
							Editing {selected.name}
						</h3>
						<Button
							size="sm"
							variant="outline"
							onclick={() => floorplans.cancel()}
							>Cancel</Button
						>
						<Button size="sm" onclick={() => floorplans.done()}>Done</Button>
					</div>
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
						{#if tool}
							<Button
								variant="outline"
								size="sm"
								class="self-start"
								disabled={!canClear}
								onclick={() => floorplans.clearPoints()}
							>
								<Eraser data-icon="inline-start" />
								Clear
							</Button>
						{/if}
					</Field.Field>

					{#if toolMessage && tool}
						<Alert.Root>
							<Info />
							<Alert.Description>{toolMessage}</Alert.Description>
						</Alert.Root>
					{/if}

					{#if tool?.kind === "points"}
						{#if selected.controlPoints.length > 0}
							<ol
								aria-label="Control points"
								class="flex flex-col gap-1 text-sm"
							>
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
								{#if selected.controlPoints.length <
									MIN_POINTS[selected.fitKind]}
									Needs {MIN_POINTS[selected.fitKind]} points; until then the
									plan keeps its shape.
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
				</section>
			{/if}
		</div>
	</ScrollArea>
</aside>

<AlertDialog.Root
	open={removing !== null}
	onOpenChange={(open) => {
		if (!open) removing = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removing?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				The plan and its image are deleted from this browser. Export the plans
				first to keep a copy.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					if (removing) floorplans.remove(removing.id);
					removing = null;
				}}
			>
				Remove
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if pdf}
	<PdfPageDialog
		pdf={pdf.document}
		onimport={importPdfPages}
		onclose={closePdf}
	/>
{/if}
