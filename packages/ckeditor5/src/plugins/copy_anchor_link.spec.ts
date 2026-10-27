import { _setModelData as setModelData, Bold, Bookmark, ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CopyAnchorLinkButton from "./copy_anchor_link.js";

describe("CopyAnchorLinkButton", () => {
    let editor: ClassicEditor;
    let getNoteId: ReturnType<typeof vi.fn<() => string | undefined>>;
    let getReferenceLinkTitleSync: ReturnType<typeof vi.fn>;
    let copyHtml: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getNoteId = vi.fn<() => string | undefined>(() => "noteAbc");
        getReferenceLinkTitleSync = vi.fn(() => "Some title");
        copyHtml = vi.fn();

        editor = await createTestEditor([Essentials, Paragraph, Bold, Bookmark, CopyAnchorLinkButton], {
            getNoteId,
            clipboard: { copy: vi.fn(), copyHtml },
            referenceLink: { getTitle: async () => "Some title", getTitleSync: getReferenceLinkTitleSync }
        });
    });

    function getButton() {
        return editor.ui.componentFactory.create("copyAnchorLink") as { fire(name: string): void };
    }

    it("loads the plugin and registers the toolbar button", () => {
        expect(editor.plugins.get(CopyAnchorLinkButton)).toBeInstanceOf(CopyAnchorLinkButton);
        expect(editor.ui.componentFactory.has("copyAnchorLink")).toBe(true);
    });

    it("copies a reference link to the clipboard when a bookmark is selected", () => {
        setModelData(editor.model, "<paragraph>[<bookmark bookmarkId=\"my anchor\"></bookmark>]</paragraph>");

        getButton().fire("execute");

        const href = "#root/noteAbc?bookmark=my%20anchor";
        expect(getReferenceLinkTitleSync).toHaveBeenCalledWith(href, undefined);
        expect(copyHtml).toHaveBeenCalledWith(`<a class="reference-link" href="${href}">Some title</a>`, href);
    });

    it("links to the note the editor holds when the button is pressed", () => {
        getNoteId.mockReturnValue("includedNote");
        setModelData(editor.model, "<paragraph>[<bookmark bookmarkId=\"anchor\"></bookmark>]</paragraph>");

        getButton().fire("execute");

        const href = "#root/includedNote?bookmark=anchor";
        expect(copyHtml).toHaveBeenCalledWith(`<a class="reference-link" href="${href}">Some title</a>`, href);
    });

    it("escapes HTML special characters in the generated link", () => {
        getReferenceLinkTitleSync.mockReturnValue("a<b>&\"c");
        setModelData(editor.model, "<paragraph>[<bookmark bookmarkId=\"anchor\"></bookmark>]</paragraph>");

        getButton().fire("execute");

        const html = copyHtml.mock.calls[0]?.[0] as string;
        expect(html).toContain("&lt;b&gt;");
        expect(html).toContain("&amp;");
        expect(html).toContain("&quot;");
        expect(html).not.toContain("<b>");
    });

    it("does nothing when the selected element is not a bookmark", () => {
        setModelData(editor.model, "<paragraph>[foo]</paragraph>");

        getButton().fire("execute");

        expect(getNoteId).not.toHaveBeenCalled();
        expect(copyHtml).not.toHaveBeenCalled();
    });

    it("does nothing when there is no selected element", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        getButton().fire("execute");

        expect(getNoteId).not.toHaveBeenCalled();
        expect(copyHtml).not.toHaveBeenCalled();
    });

    it("does nothing when the editor names no note", () => {
        getNoteId.mockReturnValue(undefined);
        setModelData(editor.model, "<paragraph>[<bookmark bookmarkId=\"anchor\"></bookmark>]</paragraph>");

        getButton().fire("execute");

        expect(getReferenceLinkTitleSync).not.toHaveBeenCalled();
        expect(copyHtml).not.toHaveBeenCalled();
    });

    it("does not throw when the host configures no clipboard bridge", async () => {
        // `navigator.clipboard` is undefined outside secure contexts (Trilium over plain HTTP), so
        // the button must never reach for it — with no host callback it is simply a no-op (#10723).
        editor = await createTestEditor([Essentials, Paragraph, Bold, Bookmark, CopyAnchorLinkButton]);
        setModelData(editor.model, "<paragraph>[<bookmark bookmarkId=\"anchor\"></bookmark>]</paragraph>");

        expect(() => getButton().fire("execute")).not.toThrow();
    });
});
