<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";

	let { children } = $props();
</script>

<ModeWatcher />
<Tooltip.Provider delayDuration={300}>{@render children()}</Tooltip.Provider>
