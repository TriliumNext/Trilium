import { _getModelData as getModelData, _getViewData as getViewData, _setModelData as setModelData, ClassicEditor, Essentials, LinkEditing, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { installGlobMock } from "../../test/globals-test-kit.js";
import ReferenceLink, { getAttachmentId, getNoteId } from "./referencelink.js";

describe("ReferenceLink", () => {
    let editor: ClassicEditor;
    let getReferenceLinkTitle: ReturnType<typeof vi.fn>;
    let getReferenceLinkTitleSync: ReturnType<typeof vi.fn>;
    let loadReferenceLinkTitle: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getReferenceLinkTitle = vi.fn(async () => "Some title");
        getReferenceLinkTitleSync = vi.fn(() => "Some title");
        loadReferenceLinkTitle = vi.fn(async () => undefined);
        installGlobMock({
            getComponentByEl: () => ({ loadReferenceLinkTitle }),
            getReferenceLinkTitle,
            getReferenceLinkTitleSync
        });

        editor = await createTestEditor([Essentials, Paragraph, LinkEditing, ReferenceLink]);
    });

    it("loads the plugin, registers the schema and the command", () => {
        expect(editor.plugins.get(ReferenceLink)).toBeInstanceOf(ReferenceLink);
        expect(editor.commands.get("referenceLink")).toBeDefined();
        expect(editor.model.schema.isRegistered("reference")).toBe(true);
        expect(editor.model.schema.isInline("reference")).toBe(true);
        expect(editor.model.schema.isObject("reference")).toBe(true);
    });

    it("inserts a reference and warms the title cache when executed with a href", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("referenceLink", { href: "#root/noteAbc" });

        expect(getReferenceLinkTitle).toHaveBeenCalledWith("#root/noteAbc");

        // The element is only inserted from the async then-callback.
        await Promise.resolve();
        await Promise.resolve();

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        expect(reference?.getAttribute("href")).toBe("#root/noteAbc");
    });

    it("does nothing when executed with an empty or whitespace-only href", async () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");

        editor.execute("referenceLink", { href: "   " });
        editor.execute("referenceLink", { href: "" });

        await Promise.resolve();
        await Promise.resolve();

        expect(getReferenceLinkTitle).not.toHaveBeenCalled();
        expect(findReference(editor)).toBeUndefined();
    });

    describe("anchored insertion during the title fetch (#10663)", () => {
        let resolveTitle: () => void = () => {};

        beforeEach(() => {
            getReferenceLinkTitle.mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        resolveTitle = resolve;
                    })
            );
        });

        it("inserts at the position captured at execute time even when typing continues during the fetch", async () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("referenceLink", { href: "#root/noteAbc" });

            // Simulate the user continuing to type while the title fetch is still pending.
            editor.execute("insertText", { text: " BBB" });

            resolveTitle();
            await Promise.resolve();
            await Promise.resolve();

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toBe('<paragraph>foo<reference href="#root/noteAbc"></reference> BBB</paragraph>');

            // The caret must stay where typing left it, not get yanked back onto the reference.
            const selection = editor.model.document.selection;
            const reference = findReference(editor);
            expect(reference).toBeDefined();
            if (!reference) {
                return;
            }
            const afterReference = editor.model.createPositionAfter(reference);
            expect(selection.getFirstPosition()?.isEqual(afterReference)).toBe(false);
        });

        it("puts the caret after the link when the selection has not moved during the fetch", async () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("referenceLink", { href: "#root/noteAbc" });

            resolveTitle();
            await Promise.resolve();
            await Promise.resolve();

            const reference = findReference(editor);
            expect(reference).toBeDefined();
            if (!reference) {
                return;
            }

            const selection = editor.model.document.selection;
            expect(selection.isCollapsed).toBe(true);
            const afterReference = editor.model.createPositionAfter(reference);
            expect(selection.getFirstPosition()?.isEqual(afterReference)).toBe(true);
        });

        it("does not insert when the picked context was deleted during the fetch", async () => {
            setModelData(editor.model, "<paragraph>foo[]</paragraph>");

            editor.execute("referenceLink", { href: "#root/noteAbc" });

            const root = editor.model.document.getRoot();
            expect(root).toBeDefined();
            if (root) {
                editor.model.change((writer) => {
                    for (const child of Array.from(root.getChildren())) {
                        writer.remove(child);
                    }
                });
            }

            resolveTitle();
            await Promise.resolve();
            await Promise.resolve();

            expect(findReference(editor)).toBeUndefined();
        });
    });

    it("is enabled where text is allowed and disabled where it is not", () => {
        const command = editor.commands.get("referenceLink");

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(command?.isEnabled).toBe(true);

        // Disallow `reference` everywhere so the schema check in refresh() fails
        // while keeping a real, renderable selection container.
        editor.model.schema.addChildCheck((_context, def) => {
            if (def.name === "reference") {
                return false;
            }
        });

        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        command?.refresh();
        expect(command?.isEnabled).toBe(false);
    });

    it("upcasts an <a class=\"reference-link\"> into a reference element", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        expect(reference?.getAttribute("href")).toBe("#root/noteAbc");
        expect(reference?.getAttribute("storedTitle")).toBe("Some title");
    });

    it("renders the reference as an inline widget in the editing view and loads its title", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const view = getViewData(editor.editing.view);
        expect(view).toContain("reference-link");
        expect(view).toContain("ck-widget");

        // Force the UIElement's render callback to run so loadReferenceLinkTitle is invoked.
        const domRoot = editor.editing.view.getDomRoot();
        const anchor = domRoot?.querySelector("a.reference-link");
        expect(anchor).not.toBeNull();
        expect(loadReferenceLinkTitle).toHaveBeenCalledTimes(1);
        expect(loadReferenceLinkTitle.mock.calls[0]?.[1]).toBe("#root/noteAbc");
        expect(loadReferenceLinkTitle.mock.calls[0]?.[2]).toBe("Some title");
    });

    it("shows a placeholder's file name, then redraws it as a titled link once uploaded", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        const reference = editor.model.change((writer) => {
            const element = writer.createElement("reference", {
                href: "",
                uploadId: "u1",
                uploadFileName: "report.pdf"
            });
            editor.model.insertContent(element);
            return element;
        });
        const findAnchor = () =>
            editor.editing.view.getDomRoot()?.querySelector("a.reference-link");

        expect(findAnchor()?.textContent).toBe("report.pdf");
        expect(findAnchor()?.querySelector(".bx-spin")).not.toBeNull();
        expect(loadReferenceLinkTitle).not.toHaveBeenCalled();

        editor.model.change((writer) => {
            writer.setAttribute("href", "#root/abc", reference);
            writer.removeAttribute("uploadFileName", reference);
        });

        expect(findAnchor()?.getAttribute("href")).toBe("#root/abc");
        expect(findAnchor()?.querySelector(".bx-spin")).toBeNull();
        expect(loadReferenceLinkTitle).toHaveBeenCalledWith(expect.anything(), "#root/abc", undefined);
    });

    it("redraws the links to a changed attachment and removes those to a deleted one", () => {
        const attachmentHref = (id: string) =>
            `#root/owner?viewMode=attachments&amp;attachmentId=${id}`;
        editor.setData(
            `<p><a class="reference-link" href="${attachmentHref("renamed")}">a</a></p>` +
            `<p><a class="reference-link" href="${attachmentHref("deleted")}">b</a></p>` +
            "<p><a class=\"reference-link\" href=\"#root/noteAbc\">c</a></p>"
        );
        loadReferenceLinkTitle.mockClear();

        editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks([
            { attachmentId: "renamed", isDeleted: false },
            { attachmentId: "deleted", isDeleted: true }
        ]);

        const redrawnHrefs = new Set(loadReferenceLinkTitle.mock.calls.map(([ , href ]) => href));
        const renamedHref = "#root/owner?viewMode=attachments&attachmentId=renamed";
        expect([ ...redrawnHrefs ]).toEqual([ renamedHref ]);
        expect(getModelData(editor.model, { withoutSelection: true })).toBe(
            `<paragraph><reference href="${renamedHref}" storedTitle="a"></reference></paragraph>` +
            "<paragraph></paragraph>" +
            "<paragraph><reference href=\"#root/noteAbc\" storedTitle=\"c\"></reference></paragraph>"
        );
        // The removal records a change made elsewhere, so undo cannot bring the link back.
        expect(editor.commands.get("undo")?.isEnabled).toBe(false);
    });

    it("redraws the links to a renamed attachment without changing the document", () => {
        const href = "#root/owner?viewMode=attachments&attachmentId=renamed";
        editor.setData(
            "<p><a class=\"reference-link\" "
            + "href=\"#root/owner?viewMode=attachments&amp;attachmentId=renamed\">a</a></p>"
        );
        const before = getModelData(editor.model);
        loadReferenceLinkTitle.mockClear();

        editor.plugins.get("ReferenceLinkEditing").updateAttachmentLinks([
            { attachmentId: "renamed", isDeleted: false }
        ]);

        expect(loadReferenceLinkTitle).toHaveBeenCalledWith(expect.anything(), href, "a");
        expect(getModelData(editor.model)).toBe(before);
    });

    it("reads the attachment a link points to, and none from a note link or a missing href", () => {
        expect(getAttachmentId("#root/owner?viewMode=attachments&attachmentId=att1")).toBe("att1");
        expect(getAttachmentId("#root/noteAbc")).toBeNull();
        expect(getAttachmentId(undefined)).toBeNull();
    });

    it("reads the note a link points to, or the attachment's owner, from its note path", () => {
        expect(getNoteId("#root/parentAbc/noteAbc")).toBe("noteAbc");
        expect(getNoteId("#root/owner?viewMode=attachments&attachmentId=att1")).toBe("owner");
        expect(getNoteId("#root")).toBe("root");
        expect(getNoteId("")).toBeNull();
        expect(getNoteId(undefined)).toBeNull();
    });

    it("dataDowncasts a reference back to an anchor, resolving the title synchronously", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc"><span>old</span></a></p>');

        const data = editor.getData();

        expect(getReferenceLinkTitleSync).toHaveBeenCalledWith("#root/noteAbc", "old");
        expect(data).toContain('class="reference-link"');
        expect(data).toContain('href="#root/noteAbc"');
        expect(data).toContain("Some title");
    });

    it("maps a view position inside the reference widget to a model position outside of it", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const reference = findReference(editor);
        expect(reference).toBeDefined();
        const referenceView = reference ? editor.editing.mapper.toViewElement(reference) : undefined;
        expect(referenceView).toBeDefined();
        if (!referenceView) {
            return;
        }

        // A position *inside* the reference widget must be remapped to a model position
        // outside the `reference` element (the predicate matches on the .reference-link class).
        const viewPosition = editor.editing.view.createPositionAt(referenceView, 0);
        const modelPosition = editor.editing.mapper.toModelPosition(viewPosition);

        expect(modelPosition.parent.is("element", "reference")).toBe(false);
    });

    it("suppresses the default link opener so reference links are not opened in a new tab", () => {
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Some title</a></p>');

        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

        const anchor = document.createElement("a");
        anchor.setAttribute("href", "#root/noteAbc");

        editor.editing.view.document.fire("click", {
            domTarget: anchor,
            domEvent: { ctrlKey: true, metaKey: true },
            preventDefault: () => {}
        });

        // Our registered opener returns true, so the default window.open path is skipped.
        expect(openSpy).not.toHaveBeenCalled();

        openSpy.mockRestore();
    });

    it("replaces the reference it is given with one to the new href, in one undo step", async () => {
        editor.setData('<p>a<a class="reference-link" href="#root/gone">Gone</a>b</p>');

        editor.execute("referenceLink", { href: "#root/noteNew", replace: findReference(editor) });
        await Promise.resolve();
        await Promise.resolve();

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe('<paragraph>a<reference href="#root/noteNew" storedTitle="Some title"></reference>b</paragraph>');

        editor.execute("undo");

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe('<paragraph>a<reference href="#root/gone" storedTitle="Gone"></reference>b</paragraph>');
    });

    it("saves the last title it saved for a link whose note goes missing while the editor is open", () => {
        let liveTitle: string | undefined = "Renamed";
        getReferenceLinkTitleSync.mockImplementation((_href: string, storedTitle?: string) =>
            liveTitle ?? storedTitle ?? "[missing note]");
        editor.setData('<p><a class="reference-link" href="#root/noteAbc">Loaded</a></p>');

        expect(editor.getData()).toContain(">Renamed</a>");

        liveTitle = undefined;

        expect(editor.getData()).toContain(">Renamed</a>");
    });

    it("asks to fix a reference to a missing note when it is clicked, and not one to a note", () => {
        const fixReferenceLink = vi.fn();
        // The test setup makes `$` a passthrough, so the title element arrives as itself.
        loadReferenceLinkTitle.mockImplementation(async (el: HTMLElement, href: string) => {
            el.classList.toggle("reference-link-missing", href === "#root/gone");
        });
        installGlobMock({
            getComponentByEl: () => ({ loadReferenceLinkTitle, fixReferenceLink }),
            getReferenceLinkTitle,
            getReferenceLinkTitleSync
        });
        editor.setData(
            '<p><a class="reference-link" href="#root/noteAbc">Fine</a>'
            + '<a class="reference-link" href="#root/gone">Gone</a></p>'
        );
        const titles = editor.editing.view.getDomRoot()?.querySelectorAll("a.reference-link > span");
        const click = (domTarget: Element | undefined) => editor.editing.view.document.fire("click", {
            domTarget,
            domEvent: {},
            preventDefault: () => {}
        });

        click(titles?.[0]);
        expect(fixReferenceLink).not.toHaveBeenCalled();

        click(titles?.[1]);
        expect(fixReferenceLink).toHaveBeenCalledTimes(1);
        expect(fixReferenceLink.mock.calls[0]?.[0]).toBe("Gone");

        const execute = vi.spyOn(editor, "execute");
        fixReferenceLink.mock.calls[0]?.[1]("#root/noteNew");
        expect(execute).toHaveBeenCalledWith("referenceLink", {
            href: "#root/noteNew",
            replace: findReference(editor)?.nextSibling
        });
    });

    it("asks with no title for a missing reference without one, and not for what only looks like one", () => {
        const fixReferenceLink = vi.fn();
        loadReferenceLinkTitle.mockImplementation(async (el: HTMLElement) => {
            el.classList.add("reference-link-missing");
        });
        installGlobMock({
            getComponentByEl: () => ({ loadReferenceLinkTitle, fixReferenceLink }),
            getReferenceLinkTitle,
            getReferenceLinkTitleSync
        });
        editor.setData(
            '<p><a class="reference-link" href="#root/gone"></a><a href="https://x.org">x</a></p>'
        );
        const domRoot = editor.editing.view.getDomRoot();
        const hyperlink = domRoot?.querySelector("a:not(.reference-link)");
        const detached = document.createElement("a");
        for (const anchor of [ hyperlink, detached ]) {
            anchor?.classList.add("reference-link");
            anchor?.append(Object.assign(document.createElement("span"), {
                className: "reference-link-missing"
            }));
        }
        const click = (domTarget: Element | null | undefined) =>
            editor.editing.view.document.fire("click", {
                domTarget,
                domEvent: {},
                preventDefault: () => {}
            });

        click(hyperlink?.querySelector("span"));
        click(detached.querySelector("span"));
        expect(fixReferenceLink).not.toHaveBeenCalled();

        click(domRoot?.querySelector("a.reference-link > span"));
        expect(fixReferenceLink).toHaveBeenCalledTimes(1);
        expect(fixReferenceLink.mock.calls[0]?.[0]).toBe("");
    });

    it("does not replace a reference deleted while the title of its replacement loads", async () => {
        editor.setData('<p>a<a class="reference-link" href="#root/gone">Gone</a>b</p>');

        editor.execute("referenceLink", { href: "#root/noteNew", replace: findReference(editor) });
        editor.model.change((writer) => {
            const reference = findReference(editor);
            if (reference) {
                writer.remove(reference);
            }
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph>ab</paragraph>");
    });
});

function findReference(editor: ClassicEditor) {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    for (const item of editor.model.createRangeIn(root).getItems()) {
        if (item.is("element", "reference")) {
            return item;
        }
    }
    return undefined;
}
