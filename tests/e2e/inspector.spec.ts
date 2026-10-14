import { expect, selectRoom, tagsBox, test } from "./fixtures.ts";

test("selecting a room shows its type and fields", async ({ page }) => {
	const editor = await selectRoom(page);
	await expect(editor.getByRole("heading", { name: "Room" })).toBeVisible();
	await expect(editor.getByLabel("Level", { exact: true })).toHaveValue("0");
	await expect(tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
});

test("editing a field changes the tags, and undo/redo revert it", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await expect(tagsBox(page)).toHaveValue("indoor=room\nlevel=0\nref=B12");

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await expect(roomNumber).toHaveValue("");

	await page.getByRole("button", { name: "Redo" }).click();
	await expect(roomNumber).toHaveValue("B12");
});

test("Ctrl+Z undoes the last edit when not typing", async ({ page }) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await editor.getByRole("heading", { name: "Room" }).click();
	await page.keyboard.press("Control+z");
	await expect(roomNumber).toHaveValue("");
});

test("changing the type keeps the other tags", async ({ page }) => {
	const editor = await selectRoom(page, { ref: "S1" });
	await editor.getByRole("button", { name: "Change type" }).click();
	await page
		.getByRole("searchbox", { name: "Search feature types" })
		.fill("stairwell");
	await editor.getByRole("button", { name: "Indoor Stairwell" }).click();

	await expect(
		editor.getByRole("heading", { name: "Indoor Stairwell" }),
	).toBeVisible();
	await expect(tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=S1\nstairs=yes",
	);
});

test("the raw tag editor edits every tag", async ({ page }) => {
	const editor = await selectRoom(page);
	await tagsBox(page).fill("indoor=room\nlevel=0\nname=Library");
	await tagsBox(page).blur();
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
	await page.mouse.click(box.x + 20, box.y + box.height - 60);
	await expect(editor).toBeHidden();
});

test("fixes outdated tags in one click, and the fix can be undone", async ({
	page,
}) => {
	const editor = await selectRoom(page, { room: "stairs" });
	const issues = editor.getByRole("region", { name: "Issues" });
	await expect(issues).toContainText("Outdated tags: room=stairs");

	await issues.getByRole("button", { name: "Upgrade to stairs=yes" }).click();
	await expect(tagsBox(page)).toHaveValue("indoor=room\nlevel=0\nstairs=yes");
	await expect(
		editor.getByRole("heading", { name: "Indoor Stairwell" }),
	).toBeVisible();
	await expect(issues).toBeHidden();

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(tagsBox(page)).toHaveValue("indoor=room\nlevel=0\nroom=stairs");
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
