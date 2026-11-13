import {
    _setModelData as setModelData, type ClassicEditor, ContextualBalloon, Essentials, Link, LinkUI,
    Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import HostedBalloon from "../hosted_balloon.js";
import HiddenEditorBalloons from "./hidden_editor_balloons.js";

describe("HiddenEditorBalloons", () => {
    let editor: ClassicEditor;
    let balloon: ContextualBalloon;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Link, HiddenEditorBalloons ]);
        balloon = editor.plugins.get(ContextualBalloon);
        setModelData(editor.model,
            "<paragraph><$text linkHref=\"https://example.com\">li[]nk</$text></paragraph>");
    });

    it("hides the link toolbar while the editor is hidden (#5742)", async () => {
        await openLinkToolbar();

        await setEditorShown(false);
        expect(balloon.view.isVisible).toBe(false);

        // Losing focus to the other tab updates the editor UI, which must not show it again.
        editor.ui.update();
        expect(balloon.view.isVisible).toBe(false);

        await setEditorShown(true);
        expect(balloon.visibleView).toBe(editor.plugins.get(LinkUI).toolbarView);
        expect(balloon.view.isVisible).toBe(true);
    });

    it("hides a balloon the host renders into while the editor is hidden", async () => {
        const hosted = new HostedBalloon(editor, "test-balloon");
        hosted.show((container) => {
            container.textContent = "Insert link";
            return () => container.replaceChildren();
        });
        await nextFrames();
        expect(balloon.view.isVisible).toBe(true);

        await setEditorShown(false);
        await nextFrames();
        expect(balloon.view.isVisible).toBe(false);

        await setEditorShown(true);
        await nextFrames();
        expect(balloon.view.isVisible).toBe(true);
        hosted.hide();
    });

    it("keeps a balloon closed while the editor was hidden closed", async () => {
        await openLinkToolbar();
        await setEditorShown(false);
        const view = balloon.visibleView;
        expect(view).not.toBeNull();
        if (view) {
            balloon.remove(view);
        }

        await setEditorShown(true);
        expect(balloon.visibleView).toBeNull();
        expect(balloon.view.isVisible).toBe(false);
    });

    it("leaves the balloon alone when none is open", async () => {
        await setEditorShown(false);
        await setEditorShown(true);
        expect(balloon.visibleView).toBeNull();
        expect(balloon.view.isVisible).toBe(false);
    });

    async function openLinkToolbar() {
        const link = editor.editing.view.getDomRoot()?.querySelector("a");
        expect(link).toBeInstanceOf(HTMLAnchorElement);
        link?.click();
        // Observers report once right after `observe()`, so the editor is hidden only after that
        // first report, as when the user switches tabs some time after the click.
        await nextFrames();
        expect(balloon.view.isVisible).toBe(true);
    }

    /** Hides the editor as the client hides the split of a background tab. */
    async function setEditorShown(isShown: boolean) {
        editor.ui.element?.style.setProperty("content-visibility", isShown ? "" : "hidden");
        await nextFrames();
    }
});

/** Waits long enough for observer callbacks to run. */
function nextFrames() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}
