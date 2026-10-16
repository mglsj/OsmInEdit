<script lang="ts">
	import Eraser from "@lucide/svelte/icons/eraser";
	import Info from "@lucide/svelte/icons/info";
	import X from "@lucide/svelte/icons/x";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import type { TransformKind } from "#lib/floorplans/georef.ts";
	import { type Message, t } from "#lib/i18n/messages.ts";
	import {
		type FloorPlans,
		MIN_POINTS,
		type Tool,
	} from "#lib/state/floorplans.svelte.ts";

	interface Props {
		floorplans: FloorPlans;
		/** Why the alignment tool ignored the last map click, if it did. */
		toolMessage?: Message | null;
	}

	let { floorplans, toolMessage = null }: Props = $props();

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
</script>

<!-- The plan in Edit's settings and alignment tools; nothing while no plan is in Edit. -->
{#if floorplans.editing}
	{@const plan = floorplans.editing}
	<section
		aria-label={`Editing ${plan.name}`}
		class="flex flex-col gap-4 rounded-md border p-3"
	>
		<div class="flex items-center gap-2">
			<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
				Editing {plan.name}
			</h3>
			<Button size="sm" variant="outline" onclick={() => floorplans.cancel()}
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
				value={plan.level ?? ""}
				onchange={(event) =>
					floorplans.update(plan.id, {
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
				value={plan.opacity}
				onValueChange={(opacity: number) =>
					floorplans.update(plan.id, { opacity })}
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
				<Alert.Description>{t(toolMessage)}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if tool?.kind === "points"}
			{#if plan.controlPoints.length > 0}
				<ol aria-label="Control points" class="flex flex-col gap-1 text-sm">
					{#each plan.controlPoints as _, i (i)}
						<li class="flex items-center gap-2">
							<span class="w-5 text-muted-foreground tabular-nums"
								>{i + 1}</span
							>
							{" "}
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
					value={plan.fitKind}
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
					{#if plan.controlPoints.length < MIN_POINTS[plan.fitKind]}
						Needs {MIN_POINTS[plan.fitKind]} points; until then the plan keeps
						its shape.
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
