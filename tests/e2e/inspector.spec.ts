import type { Locator } from "@playwright/test";
import {
	expect,
	LAT,
	LON,
	room,
	selectRoom,
	tagsBox,
	test,
} from "./fixtures.ts";

/** The Feature Type button, showing the type of the selected feature. */
function featureType(editor: Locator, name: string) {
	return editor.getByRole("button", {
		name: `${name}, change feature type`,
		exact: true,
	});
}

test("selecting a room shows its type and fields", async ({ page }) => {
	const editor = await selectRoom(page);
	await expect(featureType(editor, "Room")).toBeVisible();
	await expect(editor.getByLabel("Level", { exact: true })).toHaveValue("0");
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
});

test("editing a field changes the tags, and undo/redo revert it", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=B12",
	);

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await expect(roomNumber).toHaveValue("");

	await page.getByRole("button", { name: "Redo" }).click();
	await expect(roomNumber).toHaveValue("B12");
});

test("Ctrl+Z undoes the last edit when not typing", async ({ page }) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await editor.getByRole("heading", { name: "Edit feature" }).click();
	await page.keyboard.press("Control+z");
	await expect(roomNumber).toHaveValue("");
});

test("changing the type keeps the other tags", async ({ page }) => {
	const editor = await selectRoom(page, { ref: "S1" });
	await editor.getByRole("button", { name: /change feature type/i }).click();
	await page
		.getByRole("combobox", { name: "Search feature types" })
		.fill("stairwell");
	await editor.getByRole("option", { name: "Indoor Stairwell" }).click();

	await expect(featureType(editor, "Indoor Stairwell")).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=S1\nstairs=yes",
	);
});

test("the raw tag editor edits every tag", async ({ page }) => {
	const editor = await selectRoom(page);
	await (await tagsBox(page)).fill("indoor=room\nlevel=0\nname=Library");
	await (await tagsBox(page)).blur();
	await expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue(
		"Library",
	);
});

test("Escape and clicking elsewhere close the editor", async ({ page }) => {
	const editor = await selectRoom(page);
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();

	await selectRoom(page);
	const box = await page.getByTestId("map").boundingBox();
	if (!box) throw new Error("No map");
	// An empty spot, clear of the editor on the left.
	await page.mouse.click(box.x + box.width - 80, box.y + box.height - 60);
	await expect(editor).toBeHidden();
});

test("fixes outdated tags in one click, and the fix can be undone", async ({
	page,
}) => {
	const editor = await selectRoom(page, { room: "stairs" });
	const issues = editor.getByRole("region", { name: "Issues" });
	await expect(issues).toContainText("Outdated tags: room=stairs");

	await issues.getByRole("button", { name: "Upgrade to stairs=yes" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nstairs=yes",
	);
	await expect(featureType(editor, "Indoor Stairwell")).toBeVisible();
	await expect(issues).toBeHidden();

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=stairs",
	);
});

test("flags a level value it can't read", async ({ page }) => {
	const editor = await selectRoom(page);
	const level = editor.getByLabel("Level", { exact: true });
	await level.fill("1,5");
	await level.press("Enter");
	await expect(editor.getByRole("region", { name: "Issues" })).toContainText(
		"level=1,5 can't be read",
	);
});

test("lays the editor out in iD's sections", async ({ page }) => {
	const elements = room(100, LON, LAT, "0");
	Object.assign(elements.at(-1) as object, {
		user: "Alice",
		timestamp: "2020-01-15T10:00:00Z",
	});
	const editor = await selectRoom(page, {}, elements);
	await expect(
		editor.getByRole("heading", { name: "Edit feature" }),
	).toBeVisible();
	// Feature Type and Fields open, Tags (2) closed until asked for.
	for (const [name, open] of [
		["Feature Type", "true"],
		["Fields", "true"],
		["Tags (2)", "false"],
	] as const) {
		await expect(
			editor.getByRole("button", { name, exact: true }),
		).toHaveAttribute("aria-expanded", open);
	}
	await expect(
		editor.getByRole("button", { name: /^Room.*change feature type/i }),
	).toBeVisible();
	await expect(
		editor.getByRole("textbox", { name: "Tags", exact: true }),
	).toBeHidden();

	// The footer links to the feature on openstreetmap.org.
	const link = editor.getByRole("link", { name: "View on openstreetmap.org" });
	await expect(link).toHaveAttribute(
		"href",
		"https://www.openstreetmap.org/way/100",
	);
	await expect(editor).toContainText(/Last edited \d+ years ago by Alice/);
});

test("remembers which sections are open", async ({ page }) => {
	const editor = await selectRoom(page);
	const tags = editor.getByRole("button", { name: "Tags (2)", exact: true });
	const fields = editor.getByRole("button", { name: "Fields", exact: true });
	await tags.click();
	await fields.click();
	await expect(tags).toHaveAttribute("aria-expanded", "true");
	await expect(fields).toHaveAttribute("aria-expanded", "false");

	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
	await page.reload();
	const again = await selectRoom(page);
	await expect(
		again.getByRole("button", { name: "Tags (2)", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(
		again.getByRole("button", { name: "Fields", exact: true }),
	).toHaveAttribute("aria-expanded", "false");
});

test("opens the tags of a feature without a matching type", async ({
	page,
}) => {
	const elements = room(100, LON, LAT, "0");
	const way = elements.at(-1) as { tags: Record<string, string> };
	way.tags = { area: "yes", level: "0", survey_note: "check" };
	const editor = await selectRoom(page, {}, elements);
	await expect(
		editor.getByRole("button", { name: "Tags (3)", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
});

test("shows a ✓ to close the editor once the feature was changed", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	await expect(editor.getByRole("button", { name: "Close" })).toBeVisible();
	await editor.getByRole("textbox", { name: "Name" }).fill("Library");
	await editor.getByRole("textbox", { name: "Name" }).press("Enter");
	await expect(editor.getByRole("button", { name: "Done" })).toBeVisible();
});
