import { expect, type Page, test } from "@playwright/test";

import App from "../support/app";

/**
 * A calendar event opened from the quick-edit popup must paint above that dialog.
 * The popover is portaled to the body, so a z-index tie with the modal backdrop
 * leaves the card under the dialog (#12777).
 */
test("Calendar event popover opens above the quick-edit popup", async ({ page, context }) => {
    test.setTimeout(60_000);
    const app = new App(page, context);
    await app.goto();

    const suffix = Date.now().toString(36);
    const title = `Fair ${suffix}`;
    const startDate = await page.evaluate(() => {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        return `${now.getFullYear()}-${month}-15`;
    });
    const { calendarId, eventId } = await createCalendar(
        page, `Calendar ${suffix}`, title, startDate);

    await page.evaluate((noteId) => {
        (window as any).glob.appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId });
    }, calendarId);

    const dialog = page.locator(".modal.popup-editor-dialog.show");
    await expect(dialog).toBeVisible();
    const chip = dialog.locator(`[data-event-note-id="${eventId}"]`);
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await chip.click();

    const popover = page.locator(".calendar-event-popover");
    await expect(popover).toBeVisible();

    const hit = await elementAtPopoverCenter(page, popover, dialog);
    expect(hit.inPopover, `elementFromPoint(${hit.x}, ${hit.y}) hit ${hit.desc}`).toBe(true);
});

async function createCalendar(
    page: Page, calendarTitle: string, eventTitle: string, startDate: string
) {
    return page.evaluate(async ({ calendarTitle, eventTitle, startDate }) => {
        const headers = {
            "content-type": "application/json",
            "x-csrf-token": (window as any).glob.csrfToken
        };
        const calendarResponse = await fetch("/api/notes/root/children?target=into", {
            method: "POST",
            headers,
            body: JSON.stringify({ title: calendarTitle, content: "", type: "book" })
        });
        if (!calendarResponse.ok) {
            throw new Error(`Creating the calendar failed (status=${calendarResponse.status})`);
        }
        const calendar = await calendarResponse.json();
        const calendarId = calendar.note.noteId as string;

        const eventResponse = await fetch(`/api/notes/${calendarId}/children?target=into`, {
            method: "POST",
            headers,
            body: JSON.stringify({ title: eventTitle, content: "", type: "text" })
        });
        if (!eventResponse.ok) {
            throw new Error(`Creating the event failed (status=${eventResponse.status})`);
        }
        const event = await eventResponse.json();
        const eventId = event.note.noteId as string;

        for (const attribute of [
            { noteId: calendarId, name: "viewType", value: "calendar" },
            { noteId: eventId, name: "startDate", value: startDate }
        ]) {
            const response = await fetch(`/api/notes/${attribute.noteId}/attributes`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    type: "label", name: attribute.name, value: attribute.value
                })
            });
            if (!response.ok) {
                throw new Error(`Setting #${attribute.name} failed (status=${response.status})`);
            }
        }

        return { calendarId, eventId };
    }, { calendarTitle, eventTitle, startDate });
}

/**
 * The center of the popover when that center lies on the dialog, otherwise the nearest
 * point inside both. A miss is the dialog (or its backdrop) painted over the card.
 */
async function elementAtPopoverCenter(
    page: Page,
    popover: ReturnType<Page["locator"]>,
    dialog: ReturnType<Page["locator"]>
) {
    const popBox = await popover.boundingBox();
    const dialogBox = await dialog.boundingBox();
    if (!popBox || !dialogBox) {
        throw new Error("The popover or the quick-edit dialog has no box");
    }

    const cx = popBox.x + popBox.width / 2;
    const cy = popBox.y + popBox.height / 2;
    let x = cx;
    let y = cy;
    const inside = (
        px: number, py: number,
        box: { x: number; y: number; width: number; height: number }
    ) => px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
    if (!inside(cx, cy, dialogBox)) {
        const clampedX = Math.min(
            Math.max(cx, dialogBox.x + 2), dialogBox.x + dialogBox.width - 2);
        const clampedY = Math.min(
            Math.max(cy, dialogBox.y + 2), dialogBox.y + dialogBox.height - 2);
        if (inside(clampedX, clampedY, popBox)) {
            x = clampedX;
            y = clampedY;
        }
    }

    return page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const desc = el
            ? `${el.tagName}.${String(el.className).slice(0, 120)}`
            : "null";
        return { x, y, inPopover: !!el?.closest(".tn-popover"), desc };
    }, { x, y });
}
