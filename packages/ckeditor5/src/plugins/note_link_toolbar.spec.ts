import {
    _getModelData as getModelData, _setModelData as setModelData, Bookmark, ButtonView,
    type ClassicEditor, ContextualBalloon, Essentials, Heading, Link, LinkUI, Paragraph,
    type ToolbarView, WidgetToolbarRepository
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import BlockReferenceEditing from "./block_reference/block_reference_editing.js";
import { LinkEmbedPreviewButtonView } from "./link_embed/link_embed_toolbar.js";
import NoteLinkToolbar, { UNLINK_REFERENCE_COMMAND } from "./note_link_toolbar.js";

const NOTE = "#root/abc";
/** A link to an attachment, escaped for the model data of `_setModelData()`. */
const ATTACHMENT = "#root/abc?viewMode=attachments&amp;attachmentId=def";
const REFERENCE = `<paragraph>a [<reference href="${NOTE}"></reference>] b</paragraph>`;

describe("NoteLinkToolbar", () => {
    let editor: ClassicEditor;
    let showDialog: ReturnType<typeof vi.fn>;
    let copy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        showDialog = vi.fn(() => null);
        copy = vi.fn();
        // The host passes `clipboard` with a cast too, as the editor config does not declare it.
        editor = await createTestEditor([ Essentials, Paragraph, Link, NoteLinkToolbar ], {
            internalLink: { showDialog },
            referenceLink: { getTitle: async () => "Target", getTitleSync: () => "Target" },
            clipboard: { copy }
        } as unknown as Parameters<typeof createTestEditor>[1]);
    });

    function create<T>(name: string) {
        return editor.ui.componentFactory.create(name) as unknown as T;
    }

    it("reads Open note in the link toolbar of a link to a note, and the address otherwise", () => {
        const preview = create<ButtonView>("linkPreview");
        const linkTo = (href: string) => setModelData(editor.model,
            `<paragraph><$text linkHref="${href}">fo[]o</$text></paragraph>`);

        linkTo(NOTE);
        expect(preview.label).toBe("Open note");
        expect(preview.tooltip).toBe(false);
        linkTo(ATTACHMENT);
        expect(preview.label).toBe("Open attachment");
        // An editor that names no note has no heading of its own to jump to.
        linkTo(`${NOTE}?block=x`);
        expect(preview.label).toBe("Open note");

        for (const href of [ "https://a.example", "#rootless", "#anchor" ]) {
            linkTo(href);
            expect(preview.label).toBe(href);
        }
    });

    describe("on a reference link", () => {
        function getToolbar() {
            const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
                _toolbarDefinitions: Map<string, { view: ToolbarView }>;
            };
            return repository._toolbarDefinitions.get("referenceLink")?.view;
        }

        it("shows the buttons of the link toolbar while the reference is selected", () => {
            editor.ui.focusTracker.isFocused = true;
            const balloon = editor.plugins.get(ContextualBalloon);

            setModelData(editor.model, REFERENCE);
            const toolbar = getToolbar();
            expect(toolbar).toBeDefined();
            expect(balloon.visibleView).toBe(toolbar);
            const labels = [ ...toolbar?.items ?? [] ]
                .filter((item) => item instanceof ButtonView)
                .map((item) => item.label);
            expect(labels).toStrictEqual([ "Open note", "Copy URL", "Edit link", "Unlink" ]);

            setModelData(editor.model, `<paragraph>a[] <reference href="${NOTE}"></reference></paragraph>`);
            expect(balloon.visibleView).toBeNull();
        });

        it("opens the note from an anchor to it, styled as the link toolbar's", () => {
            const preview = create<LinkEmbedPreviewButtonView>("referenceLinkPreview");
            preview.render();
            expect(preview.element?.tagName).toBe("A");
            expect(preview.element?.classList.contains("ck-link-toolbar__preview")).toBe(true);

            setModelData(editor.model, REFERENCE);
            expect(preview.label).toBe("Open note");
            expect(preview.element?.getAttribute("href")).toBe(NOTE);

            setModelData(editor.model, `<paragraph>[<reference href="${ATTACHMENT}"></reference>]</paragraph>`);
            expect(preview.label).toBe("Open attachment");

            setModelData(editor.model, "<paragraph>a[]</paragraph>");
            expect(preview.label).toBeUndefined();
            expect(preview.href).toBeUndefined();
        });

        it("copies the address of the reference", () => {
            const button = create<ButtonView>("referenceLinkCopyUrl");
            button.fire("execute");
            expect(copy).not.toHaveBeenCalled();

            setModelData(editor.model, REFERENCE);
            button.fire("execute");
            expect(copy).toHaveBeenCalledExactlyOnceWith(NOTE);
        });

        it("opens the link dialog on the reference", () => {
            setModelData(editor.model, REFERENCE);
            create<ButtonView>("editLink").fire("execute");
            expect(showDialog).toHaveBeenCalledOnce();
        });

        it("unlinks the reference to its title, in one undo step", () => {
            const button = create<ButtonView>("referenceLinkUnlink");
            setModelData(editor.model, "<paragraph>a[]</paragraph>");
            expect(button.isEnabled).toBe(false);

            setModelData(editor.model, REFERENCE);
            expect(button.isEnabled).toBe(true);
            button.fire("execute");
            expect(getModelData(editor.model)).toBe("<paragraph>a Target[] b</paragraph>");

            editor.execute("undo");
            expect(getModelData(editor.model, { withoutSelection: true }))
                .toBe(`<paragraph>a <reference href="${NOTE}"></reference> b</paragraph>`);
            expect(editor.commands.get(UNLINK_REFERENCE_COMMAND)?.isEnabled).toBe(true);
        });
    });
});

describe("links within the note", () => {
    it("jumps to an anchor, and reads Jump to heading for a heading of the same note", async () => {
        const editor = await createTestEditor([
            Essentials, Paragraph, Heading, Bookmark, Link, BlockReferenceEditing, NoteLinkToolbar
        ], {
            getNoteId: () => "abc",
            referenceLink: { getTitle: async () => "Target", getTitleSync: () => "Target" }
        });
        const preview = editor.ui.componentFactory.create("linkPreview") as ButtonView;
        const content = "<heading1 blockId=\"h\">[]Intro</heading1>"
            + "<paragraph blockId=\"p\"><bookmark bookmarkId=\"top\"></bookmark>text</paragraph>";
        // The caret enters the link after the content is loaded, so the anchors are known.
        const linkTo = (href: string) => {
            setModelData(editor.model,
                `${content}<paragraph><$text linkHref="${href}">foo</$text></paragraph>`);
            editor.model.change((writer) => {
                const link = editor.model.document.getRoot()?.getChild(2);
                if (link) writer.setSelection(link, 1);
            });
            return preview.label;
        };

        expect([
            "#root/x/abc?block=h", "#root/def?block=h", "#root/abc?block=p",
            "#root/abc?block=gone", "#top", "#gone", "https://a.example/#top"
        ].map(linkTo)).toStrictEqual([
            "Jump to heading", "Open note", "Open note", "Open note", "Jump to anchor", "#gone",
            "https://a.example/#top"
        ]);

        // The editor follows a link into the note in place, flashing what it links to.
        const navigate = (href: string) => {
            const cancel = vi.fn();
            preview.fire("navigate", href, cancel);
            return [ cancel.mock.calls.length, takeFlashed(editor) ];
        };
        linkTo("#top");
        expect(navigate("#top")).toEqual([ 1, [ "text" ] ]);
        linkTo("#root/x/abc?block=h");
        expect(navigate("#root/x/abc?block=h")).toEqual([ 1, [ "Intro" ] ]);
        linkTo("#root/def?block=h");
        expect(navigate("#root/def?block=h")).toEqual([ 0, [] ]);

        const click = (element: HTMLElement | null | undefined, init: MouseEventInit = {}) => {
            let isCanceled = false;
            const record = (event: Event) => {
                isCanceled = event.defaultPrevented;
                // A click left to the host would open the address in the test page.
                event.preventDefault();
            };
            element?.addEventListener("click", record);
            element?.dispatchEvent(new MouseEvent("click", { cancelable: true, ...init }));
            element?.removeEventListener("click", record);
            return [ isCanceled, takeFlashed(editor) ];
        };
        const modifiers = [ { ctrlKey: true }, { metaKey: true }, { shiftKey: true } ];
        // A click with Ctrl, Cmd or Shift is left to the host, which opens a tab or a window.
        preview.render();
        linkTo("#root/x/abc?block=h");
        expect(click(preview.element)).toEqual([ true, [ "Intro" ] ]);
        expect(modifiers.map((init) => click(preview.element, init)))
            .toEqual([ [ false, [] ], [ false, [] ], [ false, [] ] ]);

        const referencePreview =
            editor.ui.componentFactory.create("referenceLinkPreview") as ButtonView;
        referencePreview.render();
        // Without a reference, the button has no address to follow.
        expect(click(referencePreview.element)).toEqual([ false, [] ]);
        setModelData(editor.model, content.replace("[]", "")
            + "<paragraph>[<reference href=\"#root/abc?block=h\"></reference>]</paragraph>");
        expect(referencePreview.label).toBe("Jump to heading");
        expect(click(referencePreview.element)).toEqual([ true, [ "Intro" ] ]);
        expect(modifiers.map((init) => click(referencePreview.element, init)))
            .toEqual([ [ false, [] ], [ false, [] ], [ false, [] ] ]);
        const cancel = vi.fn();
        referencePreview.fire("navigate", "#root/def", cancel);
        expect(cancel).not.toHaveBeenCalled();
    });
});

/** The text of the blocks that flash in `editor`, which stop flashing. */
function takeFlashed(editor: ClassicEditor) {
    const flashed = [ ...editor.editing.view.getDomRoot()?.querySelectorAll(
        ".block-reference-flash") ?? [] ];
    for (const element of flashed) {
        element.classList.remove("block-reference-flash");
    }
    return flashed.map((element) => element.textContent);
}

describe("the provider of note links", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("offers no list of links in the link form", async () => {
        const register = vi.spyOn(LinkUI.prototype, "registerLinksListProvider");
        await createTestEditor([ Essentials, Paragraph, Link, NoteLinkToolbar ]);

        expect(register).toHaveBeenCalledOnce();
        expect(register.mock.calls[0]?.[0].getListItems()).toStrictEqual([]);
    });

    it("leaves out the provider in an editor without the link toolbar", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, NoteLinkToolbar ]);
        expect(editor.plugins.has(LinkUI)).toBe(false);
        expect(editor.plugins.has(NoteLinkToolbar)).toBe(true);
    });
});
