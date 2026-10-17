/**
 * The paths of an SVG drawing as vector content, measured in the drawing's own size (its
 * `width` and `height`, else its viewBox), like the image a browser makes of it. The file is
 * parsed with `DOMParser` and never attached to the page, so its scripts never run. Shapes,
 * paths, groups and `<use>` are drawn; text, images, clip paths, masks and stylesheets aren't.
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import {
	applyTo,
	INITIAL_STYLE,
	type Matrix,
	multiply,
	parseLength,
	parsePathData,
	parseTransform,
	resolveStyle,
	type SvgStyle,
	shapePath,
} from "./svg-path.ts";
import { type Rgba, VectorBuilder, type VectorContent } from "./vector.ts";

const SHAPES = new Set([
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
]);
const CONTAINERS = new Set(["svg", "g", "a", "switch"]);
/** How deep `<use>` may refer to `<use>`: deeper ones (and loops) are left out. */
const MAX_USE_DEPTH = 8;
/** The size browsers give an SVG without one. */
const DEFAULT_SIZE = { width: 300, height: 150 };

export function extractSvg(text: string): VectorContent {
	const doc = new DOMParser().parseFromString(text, "image/svg+xml");
	const root = doc.documentElement;
	if (root.localName !== "svg" || doc.querySelector("parsererror")) {
		throw new MessageError(msg("plan_import_svg_unreadable"));
	}
	const viewBox = viewBoxOf(root);
	const size = {
		width: parseLength(
			root.getAttribute("width"),
			viewBox?.[2] ?? DEFAULT_SIZE.width,
		),
		height: parseLength(
			root.getAttribute("height"),
			viewBox?.[3] ?? DEFAULT_SIZE.height,
		),
	};
	const builder = new VectorBuilder();
	const colors = new ColorReader();

	function draw(
		element: Element,
		matrix: Matrix,
		inherited: SvgStyle,
		depth: number,
	): void {
		const name = element.localName;
		const style = resolveStyle(inherited, attributesOf(element));
		if (!style.displayed) return;
		const m = multiply(
			matrix,
			parseTransform(element.getAttribute("transform")),
		);
		if (name === "use") {
			const href =
				element.getAttribute("href") ??
				element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
			const target = href?.startsWith("#")
				? doc.getElementById(href.slice(1))
				: null;
			if (!target || depth >= MAX_USE_DEPTH) return;
			const at: Matrix = [
				1,
				0,
				0,
				1,
				parseLength(element.getAttribute("x")),
				parseLength(element.getAttribute("y")),
			];
			draw(target, multiply(m, at), style, depth + 1);
			return;
		}
		if (CONTAINERS.has(name)) {
			for (const child of element.children) draw(child, m, style, depth);
			return;
		}
		if (!SHAPES.has(name) || style.hidden) return;
		const d =
			name === "path"
				? (element.getAttribute("d") ?? "")
				: shapePath(name, attributesOf(element));
		const commands = parsePathData(d);
		if (commands.length === 0) return;
		applyTo(builder, commands, m);
		const fill = colors.read(style.fill, style.opacity * style.fillOpacity);
		if (fill) builder.fill({ color: fill, width: 0, layer: null });
		const stroke = colors.read(
			style.stroke,
			style.opacity * style.strokeOpacity,
		);
		if (stroke && style.strokeWidth > 0) {
			builder.stroke({
				color: stroke,
				width:
					style.strokeWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
				layer: null,
			});
		}
		builder.clear();
	}

	const start = viewBox
		? viewBoxMatrix(viewBox, size, root.getAttribute("preserveAspectRatio"))
		: ([1, 0, 0, 1, 0, 0] as Matrix);
	for (const child of root.children) {
		draw(child, start, resolveStyle(INITIAL_STYLE, attributesOf(root)), 0);
	}
	return builder.build(size);
}

function attributesOf(element: Element): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const attr of element.attributes) attrs[attr.localName] = attr.value;
	return attrs;
}

function viewBoxOf(element: Element): [number, number, number, number] | null {
	const values = (element.getAttribute("viewBox") ?? "")
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (values.length !== 4 || values.some((v) => !Number.isFinite(v)))
		return null;
	const [x = 0, y = 0, w = 0, h = 0] = values;
	return w > 0 && h > 0 ? [x, y, w, h] : null;
}

/** The viewBox fitted into the drawing's size, as `preserveAspectRatio` says. */
function viewBoxMatrix(
	[x, y, w, h]: [number, number, number, number],
	size: { width: number; height: number },
	preserve: string | null,
): Matrix {
	const [align = "xMidYMid", slice] = (preserve ?? "").trim().split(/\s+/);
	let sx = size.width / w;
	let sy = size.height / h;
	if (align !== "none") {
		sx = sy = slice === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
	}
	const share = (axis: "x" | "y") => {
		if (align === "none") return 0;
		const part = axis === "x" ? align.slice(1, 4) : align.slice(5, 8);
		return part === "Min" ? 0 : part === "Max" ? 1 : 0.5;
	};
	const ex = (size.width - w * sx) * share("x");
	const ey = (size.height - h * sy) * share("y");
	return [sx, 0, 0, sy, ex - x * sx, ey - y * sy];
}

/**
 * Reads CSS colours with a canvas, as the browser does. `none` and colours it can't read paint
 * nothing; gradients and patterns (`url(…)`) paint grey.
 */
class ColorReader {
	readonly #context = new OffscreenCanvas(1, 1).getContext("2d");
	readonly #cache = new Map<string, Rgba | null>();

	read(paint: string, opacity: number): Rgba | null {
		const value = paint.trim();
		if (value === "none" || value === "transparent" || opacity <= 0)
			return null;
		let color = this.#cache.get(value);
		if (color === undefined) {
			color = value.startsWith("url(")
				? [128, 128, 128, 255]
				: this.#parse(value);
			this.#cache.set(value, color);
		}
		if (!color) return null;
		return [color[0], color[1], color[2], Math.round(color[3] * opacity)];
	}

	#parse(value: string): Rgba | null {
		const context = this.#context;
		if (!context) return null;
		// Set twice from different colours: a value the canvas refuses leaves either one.
		context.fillStyle = "#000000";
		context.fillStyle = value;
		const first = String(context.fillStyle);
		context.fillStyle = "#ffffff";
		context.fillStyle = value;
		if (String(context.fillStyle) !== first) return null;
		if (first.startsWith("#")) {
			const n = Number.parseInt(first.slice(1), 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
		}
		const [r = 0, g = 0, b = 0, a = 1] = (first.match(/[\d.]+/g) ?? []).map(
			Number,
		);
		return [r, g, b, Math.round(a * 255)];
	}
}
