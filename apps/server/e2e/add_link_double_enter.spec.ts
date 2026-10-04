import { expect, test } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

// Repro for https://github.com/TriliumNext/Trilium/issues/5669
//
// Mechanism: the note autocomplete's Enter handler reads the list as it was last
// rendered. A second Enter dispatched before the list re-renders, after the first
// one picked a row and closed it, would pick from that stale list again (or, when
// the create-note row is on top, open the "Choose note type" dialog) instead of
// submitting the form.
//
// Dispatching both Enter keydowns in a single synchronous task makes the race
// deterministic: no render can run between them.
test("fast double-Enter in add-link dialog is not consumed by a stale suggestion", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();

    // Open a text note via the tree and focus its editor.
    await page.locator(".tree-wrapper .fancytree-title", { hasText: "Text notes" }).first().click();
    const editor = app.currentNoteSplit.locator(".note-detail-editable-text.visible .ck-editor__editable");
    await editor.waitFor();
    await editor.click();
    await page.keyboard.press("Control+l");

    const dialog = page.locator(".add-link-dialog");
    await expect(dialog).toBeVisible();

    const input = dialog.locator("input.note-autocomplete");
    await input.pressSequentially("Highlights");

    // The list opens on its first note, the search and creation rows coming after
    // the notes. Looked up in the dialog, where the popup renders: a hidden Empty
    // tab keeps a list with the same classes in the page.
    const highlighted = dialog.locator(".note-autocomplete-menu .dropdown-item.tn-menu-active");
    await expect(highlighted).toBeVisible();
    await expect(highlighted.locator(".bx-search, .bx-plus, .bx-subdirectory-right")).toHaveCount(0);
    await page.waitForTimeout(300);

    // Fire both Enters in one synchronous task — zero timers can interleave —
    // and record what each one did.
    const result = await page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>(".add-link-dialog input.note-autocomplete");
        if (!el) throw new Error("autocomplete input not found");

        const fire = () => {
            const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
            Object.defineProperty(e, "keyCode", { value: 13 });
            Object.defineProperty(e, "which", { value: 13 });
            el.dispatchEvent(e);
            return e.defaultPrevented;
        };
        const firstPrevented = fire();
        const secondPrevented = fire();
        return { firstPrevented, secondPrevented };
    });

    // The first Enter must pick the note under the cursor…
    expect(result.firstPrevented).toBe(true);

    // …and the second Enter must NOT be consumed by the autocomplete: no second
    // pick, no "Choose note type" dialog, and the default action (form
    // submission = adding the link) left intact.
    expect(result.secondPrevented).toBe(false);
    await expect(page.locator(".note-type-chooser-dialog")).not.toBeVisible({ timeout: 2000 });
    await expect(input).toHaveAttribute("data-note-path", /.+/);
});
