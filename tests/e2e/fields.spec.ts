import {
	expect,
	selectRoom,
	serveTaginfo,
	tagsBox,
	test,
} from "./fixtures.ts";

test("a combo suggests the values used elsewhere, and stores what is typed as a tag value", async ({
	page,
}) => {
	const requests = await serveTaginfo(page, {
		room: ["office", "class", "kitchen", "toilets"],
	});
	const editor = await selectRoom(page);
	const type = editor.getByRole("combobox", { name: "Type" });
	await type.click();
	await type.press("ArrowDown");
	await expect(page.getByRole("option", { name: "kitchen" })).toBeVisible();
	// Asked for values on ways (rooms are areas).
	expect(requests.at(-1)?.searchParams.get("filter")).toBe("ways");

	await type.fill("Class Room");
	await type.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=class_room",
	);
});

test("a combo completes what is typed, as in iD", async ({ page }) => {
	await serveTaginfo(page, { room: ["office", "kitchen"] });
	const editor = await selectRoom(page);
	const type = editor.getByRole("combobox", { name: "Type" });
	await type.click();
	await type.pressSequentially("kit");
	await expect(type).toHaveValue("kitchen");
	await type.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=kitchen",
	);
});

test("a fixed list shows labels and stores their values", async ({ page }) => {
	const editor = await selectRoom(page, { amenity: "cafe" });
	const internet = editor.getByRole("combobox", { name: "Internet Connection" });
	await expect(internet).toHaveAttribute("readonly");
	await internet.click();
	await page.getByRole("option", { name: "Wifi" }).click();
	await expect(internet).toHaveValue("Wifi");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\ninternet_access=wlan\nlevel=0",
	);

	// Its value can't be typed over, only taken off.
	await internet.press("Backspace");
	await expect(internet).toHaveValue("");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0",
	);
});
