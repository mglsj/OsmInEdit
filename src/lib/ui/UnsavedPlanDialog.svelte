<script lang="ts">
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import type { FloorPlans } from "#lib/state/floorplans.svelte.ts";

	interface Props {
		/** Asks while `floorplans.confirming`, and answers with `floorplans.resolve`. */
		floorplans: FloorPlans;
	}

	let { floorplans }: Props = $props();
</script>

<Dialog.Root
	open={floorplans.confirming}
	onOpenChange={(open) => {
		// Escape or a click outside: back to editing.
		if (!open && floorplans.confirming) floorplans.resolve("keep");
	}}
>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>Save changes to {floorplans.editing?.name}?</Dialog.Title>
			<Dialog.Description>
				This floor plan has changes you haven't saved since you pressed Edit.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => floorplans.resolve("keep")}>
				Keep editing
			</Button>
			<Button variant="outline" onclick={() => floorplans.resolve("discard")}>
				Discard
			</Button>
			<Button onclick={() => floorplans.resolve("save")}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
