<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import {
		GPUInitializationError,
		Map as MapLibreMap,
		NavigationControl,
		ScaleControl
	} from 'maplibre-gl';
	import { onMount } from 'svelte';
	import { MAX_ZOOM, type MapView } from '#lib/map/hash.ts';

	type Camera = Omit<MapView, 'level'>;

	interface Props {
		styleUrl: string;
		/** Camera at creation time. Later changes go through `map.jumpTo`. */
		initialCamera: Camera;
		/** The MapLibre map, once created. */
		map?: MapLibreMap;
		/** Called once the style is loaded and after every camera movement. */
		onmove?: (camera: Camera) => void;
	}

	let { styleUrl, initialCamera, map = $bindable(), onmove }: Props = $props();

	let container: HTMLDivElement;
	let error = $state<string>();
	let camera = $state<Camera>();

	onMount(() => {
		let instance: MapLibreMap;
		try {
			instance = new MapLibreMap({
				container,
				style: styleUrl,
				center: [initialCamera.lon, initialCamera.lat],
				zoom: initialCamera.zoom,
				maxZoom: MAX_ZOOM,
				attributionControl: { compact: true }
			});
		} catch (e) {
			error =
				e instanceof GPUInitializationError
					? 'Your browser could not start WebGL, which is needed to display the map.'
					: `The map could not be created: ${String(e)}`;
			return;
		}

		instance.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
		instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

		const notify = () => {
			const center = instance.getCenter();
			camera = { zoom: instance.getZoom(), lat: center.lat, lon: center.lng };
			onmove?.(camera);
		};
		instance.on('load', notify);
		instance.on('moveend', notify);
		// Tile errors are frequent and transient; only report a basemap style that can't load.
		let styleLoaded = false;
		instance.once('style.load', () => (styleLoaded = true));
		instance.on('error', (event) => {
			if (!styleLoaded) {
				error = `The basemap could not be loaded: ${event.error.message}`;
			}
		});

		map = instance;
		return () => {
			map = undefined;
			instance.remove();
		};
	});
</script>

<div
	bind:this={container}
	class="h-full w-full"
	data-testid="map"
	data-zoom={camera?.zoom}
	data-center={camera ? `${camera.lat},${camera.lon}` : undefined}
></div>

{#if error}
	<div
		role="alert"
		class="absolute inset-x-4 top-4 z-10 mx-auto max-w-lg rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 shadow dark:bg-red-950 dark:text-red-100"
	>
		{error}
	</div>
{/if}
