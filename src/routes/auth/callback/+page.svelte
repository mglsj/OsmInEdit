<script lang="ts">
	// Landing page of the OSM login popup: hands the result back to the editor (osm-auth listens
	// on this channel), then closes itself.
	new BroadcastChannel("osm-api-auth-complete").postMessage(location.href);
	window.close();
</script>

<svelte:head>
	<title>Logging in – IndoorID</title>
</svelte:head>

<p class="p-6 text-sm">You are logged in. You can close this window.</p>
