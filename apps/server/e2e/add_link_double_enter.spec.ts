import { expect, test } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

// Repro for https://github.com/TriliumNext/Trilium/issues/5669
//
// Mechanism: after Enter selects a note, autocomplete.js closes the dropdown but
// only *defers* emptying it (setTimeout 0). Until that timer fires, the stale
// suggestion rows are still in the DOM, and _onEnterKeyed happily selects
// getDatumForCursor()/getDatumForTopSuggestion() even though the dropdown is
// closed. A second Enter landing inside that window is therefore consumed by
// autocomplete (re-selecting a stale row — or, when the create-note row is on
// top, opening the "Choose note type" dialog) instead of submitting the form.
//
// Dispatching both Enter keydowns in a single synchronous task makes the race
// deterministic: the deferred empty() can never run between them. (Humans hit
// the same window when the second keypress is dispatched ahead of the pending
// 0 ms timer — input events are prioritized over timers, especially with a
// busy main thread right after the dialog re-renders.)
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

    // Row 0 is the prepended "Create note 'Highlights'" row; wait for a real note row too.
    await expect(page.locator(".aa-dropdown-menu:visible .aa-suggestion").nth(1)).toBeVisible();

    // Move the cursor onto a real note row, as in the issue's repro steps, and
    // let the re-query the arrows can trigger settle.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);

    // Fire both Enters in one synchronous task — zero timers can interleave —
    // and record what each one did.
    const result = await page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>(".add-link-dialog input.note-autocomplete");
        if (!el) throw new Error("autocomplete input not found");

        const selections: string[] = [];
        const jq = (window as unknown as { $: (el: HTMLElement) => { on: (ev: string, cb: (e: unknown, s?: { action?: string; noteTitle?: string }) => void) => void } }).$;
        jq(el).on("autocomplete:selected", (_e, s) => selections.push(`${s?.action ?? "note"}:${s?.noteTitle}`));

        const fire = () => {
            const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
            Object.defineProperty(e, "keyCode", { value: 13 });
            Object.defineProperty(e, "which", { value: 13 });
            el.dispatchEvent(e);
            return e.defaultPrevented;
        };
        const firstPrevented = fire();
        const secondPrevented = fire();
        return { selections, firstPrevented, secondPrevented };
    });

    // The first Enter must select the note under the cursor…
    expect(result.selections.length).toBe(1);
    expect(result.firstPrevented).toBe(true);

    // …and the second Enter must NOT be consumed by autocomplete: no second
    // selection, no "Choose note type" dialog, and the default action (form
    // submission = adding the link) left intact.
    expect(result.secondPrevented).toBe(false);
    await expect(page.locator(".note-type-chooser-dialog")).not.toBeVisible({ timeout: 2000 });
    await expect(input).toHaveAttribute("data-note-path", /.+/);
});
