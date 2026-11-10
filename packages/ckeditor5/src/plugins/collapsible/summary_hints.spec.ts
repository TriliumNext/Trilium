import {
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    Image,
    ImageResize,
    Paragraph,
    Widget
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import { registerTestCleanup } from "../../../test/globals-test-kit.js";
import { ContentHintManager } from "../../content_hint_manager.js";
import ContentEmbed from "../content_embed/content_embed.js";
import CollapsibleEditing from "./collapsible_editing.js";

/**
 * The hint popup attached to each `<summary>`. Visibility is derived from two independent drivers,
 * hover and caret, so the interesting cases are the transitions between them.
 */
describe("collapsible summary hints", () => {
    let editor: ClassicEditor;
    let root: HTMLElement;

    async function createEditor(extraConfig: Record<string, unknown> = {}): Promise<void> {
        editor = await createTestEditor([Essentials, Paragraph, CollapsibleEditing], extraConfig);
        getEditorElement(editor).style.cssText = "width: 600px; position: absolute; top: 0; left: 0;";
        root = editor.editing.view.getDomRoot() as HTMLElement;
    }

    const summaryDom = (index = 0) =>
        root.querySelectorAll<HTMLElement>("details.trilium-collapsible > summary")[index];

    function hover(target: HTMLElement, type: "mouseenter" | "mouseleave"): void {
        target.dispatchEvent(new MouseEvent(type, { bubbles: false }));
    }

    /** Tooltip elements Bootstrap has attached to the document for this editor. */
    const tooltips = () => document.querySelectorAll(".tooltip, [data-bs-toggle], .text-editor-content-tooltip");

    beforeEach(async () => {
        await createEditor();
    });

    it("does not throw when the pointer enters and leaves a title", () => {
        setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");
        editor.editing.view.forceRender();
        const summary = summaryDom();

        expect(() => {
            hover(summary, "mouseenter");
            hover(summary, "mouseleave");
        }).not.toThrow();
    });

    it("keeps the hint alive across a hover that starts while the caret is elsewhere", () => {
        setModelData(
            editor.model,
            "<details><summary>Title</summary><paragraph>body</paragraph></details><paragraph>out[]side</paragraph>"
        );
        editor.editing.view.forceRender();
        const summary = summaryDom();

        hover(summary, "mouseenter");
        // Now move the caret into the title as well — caret should take over from hover.
        editor.model.change((writer) => {
            const details = editor.model.document.getRoot()?.getChild(0);
            const title = details?.is("element") ? details.getChild(0) : null;
            if (title?.is("element")) {
                writer.setSelection(title, 0);
            }
        });
        hover(summary, "mouseleave");

        expect(summaryDom()).toBe(summary);
    });

    it("rebinds its listeners when a reconvert replaces the summary's DOM node", () => {
        setModelData(
            editor.model,
            "<details open=\"true\"><summary>Title</summary><paragraph>body[]</paragraph></details>"
        );
        editor.editing.view.forceRender();
        const before = summaryDom();

        hover(before, "mouseenter");

        // Changing a body block triggers a reconvert of the whole <details>.
        editor.model.change((writer) => {
            const details = editor.model.document.getRoot()?.getChild(0);
            const body = details?.is("element") ? details.getChild(1) : null;
            if (body?.is("element")) {
                writer.insertText("more", body, "end");
            }
        });
        editor.editing.view.forceRender();

        const after = summaryDom();
        expect(after).toBeInstanceOf(HTMLElement);
        // Hovering the fresh node must still be wired up.
        expect(() => {
            hover(after, "mouseenter");
            hover(after, "mouseleave");
        }).not.toThrow();
    });

    it("reaps the state when the collapsible is removed", () => {
        setModelData(
            editor.model,
            "<details><summary>Title</summary><paragraph>body</paragraph></details><paragraph>[]after</paragraph>"
        );
        editor.editing.view.forceRender();
        expect(summaryDom()).toBeInstanceOf(HTMLElement);

        editor.model.change((writer) => {
            const details = editor.model.document.getRoot()?.getChild(0);
            if (details?.is("element")) {
                writer.remove(details);
            }
        });
        editor.editing.view.forceRender();

        expect(summaryDom()).toBeUndefined();
        expect(() => editor.editing.view.forceRender()).not.toThrow();
    });

    it("gives no hint to the titles inside an embedded note", async () => {
        const createHandle = vi.spyOn(ContentHintManager.prototype, "createHandle");
        registerTestCleanup(() => createHandle.mockRestore());
        const embedEditor = await createTestEditor(
            [Essentials, Paragraph, Widget, ContentEmbed, CollapsibleEditing],
            { contentEmbed: { loadNote: renderEmbeddedCollapsible } }
        );

        embedEditor.setData(
            "<details><summary>Own</summary><p>body</p></details>" +
            "<figure class=\"include-note\" data-note-id=\"included\"></figure>"
        );

        const domRoot = embedEditor.editing.view.getDomRoot();
        const own = domRoot?.querySelector(":scope > details > summary");
        const embedded = domRoot?.querySelector(".include-note-wrapper summary");
        const hinted = createHandle.mock.calls.map(([element]) => element);
        expect(embedded).toBeInstanceOf(HTMLElement);
        expect(hinted).toContain(own);
        expect(hinted).not.toContain(embedded);
    });

    it("skips all hint wiring when content hints are switched off", async () => {
        await editor.destroy();
        await createEditor({ contentHintsEnabled: false });

        setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");
        editor.editing.view.forceRender();
        const summary = summaryDom();
        const before = tooltips().length;

        hover(summary, "mouseenter");

        expect(tooltips().length).toBe(before);
    });

    it("shows the drag handle's own hint on hover", () => {
        setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");
        editor.editing.view.forceRender();
        const handle = root.querySelector<HTMLElement>(".trilium-collapsible-handle");
        if (!handle) {
            throw new Error("Expected a rendered drag handle.");
        }

        expect(() => {
            hover(handle, "mouseenter");
            hover(handle, "mouseleave");
        }).not.toThrow();
    });

    it("tears everything down without leaking on destroy", async () => {
        setModelData(editor.model, "<details><summary>Title[]</summary><paragraph>body</paragraph></details>");
        editor.editing.view.forceRender();
        hover(summaryDom(), "mouseenter");

        await expect(editor.destroy()).resolves.not.toThrow();
        // A second destroy from the kit's afterEach must stay harmless.
        vi.restoreAllMocks();
    });

    it("tears down cleanly when an image resizer renders after the root is detached", async () => {
        const imageEditor = await createTestEditor([
            Essentials, Paragraph, Image, ImageResize, CollapsibleEditing
        ]);
        imageEditor.setData(
            "<details><summary>Title</summary><p>body</p></details>" +
            `<figure class="image"><img src="${PIXEL_PNG}"></figure>`
        );
        const imageRoot = imageEditor.editing.view.getDomRoot();
        await vi.waitFor(() => {
            expect(imageRoot?.querySelector(".ck-widget__resizer")).toBeInstanceOf(HTMLElement);
        });

        // WidgetResize loads before CollapsibleEditing, so its destroy() changes the view after the
        // editor UI has detached the editing root.
        await expect(imageEditor.destroy()).resolves.toBeUndefined();
    });
});

/** A 1x1 PNG that loads, so ImageResize attaches its resizer. */
const PIXEL_PNG = "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** `contentEmbed.loadNote` stub: renders an included note that contains a collapsible. */
function renderEmbeddedCollapsible(_noteId: string, wrapper: HTMLElement): void {
    wrapper.innerHTML =
        "<details class=\"trilium-collapsible\"><summary>Included</summary><p>inner</p></details>";
}
