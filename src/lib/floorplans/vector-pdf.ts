/**
 * The paths of a PDF page, from pdf.js's operator list, as vector content in points from the
 * page's top left (the page's viewport at scale 1). Follows the transform, colours, opacity
 * and line width through save and restore and form XObjects, and the CAD layer (optional
 * content group) each path is in. Clipping paths, shadings, images and text are left out.
 * Pure: pdf.js's operator codes come as an argument, so pdf.js loads only when a PDF does.
 */
import { rgba, VectorBuilder, type VectorContent } from "./vector.ts";

export interface OperatorList {
	readonly fnArray: ArrayLike<number>;
	readonly argsArray: ArrayLike<unknown>;
}

/** The pdf.js operator codes read here (`OPS` from pdf.js). */
export type PdfOps = Record<
	| "save"
	| "restore"
	| "transform"
	| "paintFormXObjectBegin"
	| "paintFormXObjectEnd"
	| "setLineWidth"
	| "setGState"
	| "setStrokeRGBColor"
	| "setFillRGBColor"
	| "setStrokeColorN"
	| "setFillColorN"
	| "setStrokeTransparent"
	| "setFillTransparent"
	| "constructPath"
	| "stroke"
	| "closeStroke"
	| "fill"
	| "eoFill"
	| "fillStroke"
	| "eoFillStroke"
	| "closeFillStroke"
	| "closeEOFillStroke"
	| "rawFillPath"
	| "beginMarkedContent"
	| "beginMarkedContentProps"
	| "endMarkedContent",
	number
>;

export interface PageViewport {
	readonly width: number;
	readonly height: number;
	/** From PDF user space to the viewport: `[a, b, c, d, e, f]`. */
	readonly transform: ArrayLike<number>;
}

/** pdf.js's path codes. */
const MOVE = 0;
const LINE = 1;
const CUBIC = 2;
const QUAD = 3;
const CLOSE = 4;

/** Colour given to pattern paint: patterns aren't drawn. */
const PATTERN = "#808080";

type Matrix = [number, number, number, number, number, number];

interface State {
	ctm: Matrix;
	stroke: string | null;
	fill: string | null;
	strokeAlpha: number;
	fillAlpha: number;
	width: number;
}

function multiply(m: Matrix, n: ArrayLike<number>): Matrix {
	const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = Array.from(n);
	return [
		m[0] * a + m[2] * b,
		m[1] * a + m[3] * b,
		m[0] * c + m[2] * d,
		m[1] * c + m[3] * d,
		m[0] * e + m[2] * f + m[4],
		m[1] * e + m[3] * f + m[5],
	];
}

/** A PDF page's paths, with the page's optional content groups (`id → name, visible`). */
export function extractPdfPage(
	list: OperatorList,
	viewport: PageViewport,
	{
		OPS,
		groups = new Map(),
	}: {
		readonly OPS: PdfOps;
		readonly groups?: ReadonlyMap<string, { name: string; visible: boolean }>;
	},
): VectorContent {
	const builder = new VectorBuilder();
	let state: State = {
		ctm: multiply([1, 0, 0, 1, 0, 0], viewport.transform),
		stroke: "#000000",
		fill: "#000000",
		strokeAlpha: 1,
		fillAlpha: 1,
		width: 1,
	};
	const saved: State[] = [];
	/** The layer of each open marked content section: inner sections inherit it. */
	const layers: (string | null)[] = [];
	const strokes = new Set([
		OPS.stroke,
		OPS.closeStroke,
		OPS.fillStroke,
		OPS.eoFillStroke,
		OPS.closeFillStroke,
		OPS.closeEOFillStroke,
	]);
	const fills = new Set([
		OPS.fill,
		OPS.eoFill,
		OPS.fillStroke,
		OPS.eoFillStroke,
		OPS.closeFillStroke,
		OPS.closeEOFillStroke,
		OPS.rawFillPath,
	]);

	for (let i = 0; i < list.fnArray.length; i++) {
		const fn = list.fnArray[i];
		const args = (list.argsArray[i] ?? []) as unknown[];
		switch (fn) {
			case OPS.save:
				saved.push(state);
				state = { ...state };
				break;
			case OPS.restore:
				state = saved.pop() ?? state;
				break;
			case OPS.transform:
				state = { ...state, ctm: multiply(state.ctm, args as number[]) };
				break;
			case OPS.paintFormXObjectBegin: {
				saved.push(state);
				const matrix = args[0] as number[] | null;
				state = matrix
					? { ...state, ctm: multiply(state.ctm, matrix) }
					: { ...state };
				break;
			}
			case OPS.paintFormXObjectEnd:
				state = saved.pop() ?? state;
				break;
			case OPS.setLineWidth:
				state = { ...state, width: Number(args[0]) };
				break;
			case OPS.setGState:
				for (const [key, value] of args[0] as [string, unknown][]) {
					if (key === "LW") state = { ...state, width: Number(value) };
					else if (key === "CA")
						state = { ...state, strokeAlpha: Number(value) };
					else if (key === "ca") state = { ...state, fillAlpha: Number(value) };
				}
				break;
			case OPS.setStrokeRGBColor:
				state = { ...state, stroke: String(args[0]) };
				break;
			case OPS.setFillRGBColor:
				state = { ...state, fill: String(args[0]) };
				break;
			case OPS.setStrokeColorN:
				state = { ...state, stroke: PATTERN };
				break;
			case OPS.setFillColorN:
				state = { ...state, fill: PATTERN };
				break;
			case OPS.setStrokeTransparent:
				state = { ...state, stroke: null };
				break;
			case OPS.setFillTransparent:
				state = { ...state, fill: null };
				break;
			case OPS.beginMarkedContentProps: {
				const [tag, props] = args as [
					string,
					{ type?: string; id?: string; ids?: string[] } | null,
				];
				const layer =
					tag === "OC" && props
						? ((props.type === "OCG" ? props.id : props.ids?.[0]) ?? null)
						: (layers.at(-1) ?? null);
				layers.push(layer);
				break;
			}
			case OPS.beginMarkedContent:
				layers.push(layers.at(-1) ?? null);
				break;
			case OPS.endMarkedContent:
				layers.pop();
				break;
			case OPS.constructPath: {
				const paint = args[0] as number;
				const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
				const stroked = strokes.has(paint) && state.stroke !== null;
				const filled = fills.has(paint) && state.fill !== null;
				if (!data || !(stroked || filled)) break;
				walk(builder, data, state.ctm);
				const layer = layers.at(-1) ?? null;
				if (filled) {
					builder.fill({
						color: rgba(state.fill ?? "", state.fillAlpha),
						width: 0,
						layer,
					});
				}
				if (stroked) {
					const [a, b, c, d] = state.ctm;
					builder.stroke({
						color: rgba(state.stroke ?? "", state.strokeAlpha),
						width: state.width * Math.sqrt(Math.abs(a * d - b * c)),
						layer,
					});
				}
				builder.clear();
				break;
			}
		}
	}
	return builder.build(
		{ width: viewport.width, height: viewport.height },
		groups,
	);
}

/** Feeds pdf.js path data to the builder, placed by `m`. */
function walk(
	builder: VectorBuilder,
	data: ArrayLike<number>,
	m: Matrix,
): void {
	const x = (u: number, v: number) => m[0] * u + m[2] * v + m[4];
	const y = (u: number, v: number) => m[1] * u + m[3] * v + m[5];
	const at = (k: number) => data[k] ?? 0;
	for (let k = 0; k < data.length; ) {
		switch (data[k++]) {
			case MOVE:
				builder.moveTo(x(at(k), at(k + 1)), y(at(k), at(k + 1)));
				k += 2;
				break;
			case LINE:
				builder.lineTo(x(at(k), at(k + 1)), y(at(k), at(k + 1)));
				k += 2;
				break;
			case CUBIC:
				builder.cubicTo(
					x(at(k), at(k + 1)),
					y(at(k), at(k + 1)),
					x(at(k + 2), at(k + 3)),
					y(at(k + 2), at(k + 3)),
					x(at(k + 4), at(k + 5)),
					y(at(k + 4), at(k + 5)),
				);
				k += 6;
				break;
			case QUAD:
				builder.quadTo(
					x(at(k), at(k + 1)),
					y(at(k), at(k + 1)),
					x(at(k + 2), at(k + 3)),
					y(at(k + 2), at(k + 3)),
				);
				k += 4;
				break;
			case CLOSE:
				builder.close();
				break;
			default:
				return;
		}
	}
}
