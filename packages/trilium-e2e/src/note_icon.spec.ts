import { expect,test } from "@playwright/test";

import App from "./support/app";

/**
 * On a phone an icon is picked from a modal of its own rather than from a menu (see IconPicker), and
 * picking one closes that modal — which is asked for as soon as the first icon is tapped, sometimes
 * while the modal is still opening. Bootstrap ignores a dialog told to close mid-opening, so what
 * used to be left behind was an emptied dialog and its backdrop: a sheet of nothing over the whole
 * page, swallowing every press on it.
 */
test("An icon picked while its modal is still opening takes the modal away with it", async ({ page, context }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    const app = new App(page, context);
    // A note of the shared database, straight from its address: a phone opens on no note at all, and
    // the icon of no note is not there to be picked (see NoteIcon).
    await app.goto({ isMobile: true, url: "/#root/qlLRRwU3qlkR" });

    // The opening lasts a fraction of a second, which a test cannot reliably tap inside of; slow it
    // right down, so that the picker's own closing always lands within it.
    const slowedOpening = await page.addStyleTag({
        content: ".modal.fade .modal-dialog { transition-duration: 4s !important; }"
    });

    const noteIcon = app.currentNoteSplit.locator(".note-icon-widget button.note-icon").first();
    const modal = page.locator(".modal.icon-switcher.show");
    // Enabled once the note is open: the icon of no note cannot be picked (see NoteIcon).
    await expect(noteIcon).toBeEnabled();
    await noteIcon.click();
    await modal.locator(".icon-list span.tn-icon").first().click();

    // Nothing of the dialog may outlive it.
    await expect(modal).toBeHidden({ timeout: 15000 });
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    await expect(page.locator("body.modal-open")).toHaveCount(0);
    // What is under it can be pressed again, which is what the leftover backdrop took away.
    await expect(noteIcon).toBeVisible();

    // Leave the note wearing the icon it was found in, the database being shared with every other
    // test here. The dialog opens at its own pace again for it.
    await slowedOpening.evaluate((style) => style.parentNode?.removeChild(style));
    await noteIcon.click();
    await expect(modal).toBeVisible();
    await modal.locator(".filter-row button.bx-dots-vertical-rounded").click();
    await page.locator(".dropdown-menu.show .dropdown-item").first().click();
    await expect(modal).toBeHidden();
});
