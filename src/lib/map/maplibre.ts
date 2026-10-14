/**
 * Entry point for MapLibre GL JS: import MapLibre from here, never from "maplibre-gl" directly.
 *
 * MapLibre 6 decodes tiles and GeoJSON in a web worker. Inside a bundler it cannot find the
 * worker file by itself, and without this call every data source silently fails to load.
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

export * from "maplibre-gl";
