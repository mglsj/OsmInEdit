/** Spherical geometry for floor plan tests: an independent source of expected positions. */
import type { LngLat } from "./georef.ts";

/*
 * Expected positions come from plain spherical geometry (Earth radius 6378137 m, the radius of
 * Web Mercator), not from the module's Mercator maths: over a few dozen metres the two agree to
 * well under a millimetre.
 */
const R = 6378137;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point `east` and `north` metres away from `origin`. */
export function offset(origin: LngLat, east: number, north: number): LngLat {
	const [lon, lat] = origin;
	return [lon + deg(east / (R * Math.cos(rad(lat)))), lat + deg(north / R)];
}

/** Great-circle distance in metres. */
export function distance(a: LngLat, b: LngLat): number {
	const dLat = rad(b[1] - a[1]);
	const dLon = rad(b[0] - a[0]);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A scanned plan, north up, 5 cm per pixel, its top-left pixel at `origin`: pixel (u, v) lies
 * 0.05·u m east and 0.05·v m south of it.
 */
export function northUpPlan(origin: LngLat) {
	return (u: number, v: number) => offset(origin, 0.05 * u, -0.05 * v);
}

export const RENNES: LngLat = [-1.6953, 48.1368];
