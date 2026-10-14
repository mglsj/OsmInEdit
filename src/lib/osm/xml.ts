/** Escapes text for an XML attribute value. */
export function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("\n", "&#10;")
		.replaceAll("\r", "&#13;")
		.replaceAll("\t", "&#9;");
}
