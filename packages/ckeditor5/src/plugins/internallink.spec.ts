import {
    _getModelData as getModelData, _setModelData as setModelData, Bold, Bookmark, ButtonView,
    ClassicEditor, CodeBlock, ContextualBalloon, Essentials, keyCodes, type KeystrokeHandler,
    Link, LinkEditing, LinkUI, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import InternalLinkPlugin, {
    COMMAND_NAME, getAnchorNames, getLinkAtSelection, type LinkDialogRequest,
    replaceLinkAtSelection
} from "./internallink.js";
import LinkEmbedEditing from "./link_embed/link_embed_editing.js";

describe("InternalLinkPlugin", () => {
    let editor: ClassicEditor;
    let showDialog: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        showDialog = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, InternalLinkPlugin], {
            internalLink: { showDialog }
        });
    });

    /** Has the host render into the balloon, answering with the request and the release. */
    function renderIntoBalloon() {
        const shown: { request?: LinkDialogRequest } = {};
        const release = vi.fn();
        showDialog.mockImplementation((request: LinkDialogRequest) => {
            shown.request = request;
            return release;
        });
        return { shown, release };
    }

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(InternalLinkPlugin)).toBeInstanceOf(InternalLinkPlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("internalLink")).toBe(true);
    });

    it("opens the host's dialog in a balloon at the caret, until the host closes it", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const { shown, release } = renderIntoBalloon();
        const balloon = editor.plugins.get(ContextualBalloon);

        editor.execute(COMMAND_NAME, { target: "url" });
        const container = shown.request?.container;
        expect(shown.request?.target).toBe("url");
        expect(container?.classList.contains("add-link-balloon")).toBe(true);
        expect(container && balloon.view.element?.contains(container)).toBe(true);

        shown.request?.close();
        expect(release).toHaveBeenCalledOnce();
        expect(balloon.visibleView).toBeNull();
    });

    it("closes the balloon for a host that shows the dialog its own way, or has none", async () => {
        const plainEditor = await createTestEditor([ Essentials, Paragraph, InternalLinkPlugin ]);

        for (const testEditor of [ editor, plainEditor ]) {
            setModelData(testEditor.model, "<paragraph>foo[]</paragraph>");
            const balloon = testEditor.plugins.get(ContextualBalloon);
            const add = vi.spyOn(balloon, "add");

            testEditor.execute(COMMAND_NAME);
            expect(add).toHaveBeenCalledOnce();
            expect(balloon.visibleView).toBeNull();
        }
        expect(showDialog).toHaveBeenCalledOnce();
    });

    it("lets go of the dialog when the editor is torn down under it", async () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const { release } = renderIntoBalloon();
        editor.execute(COMMAND_NAME);

        await editor.destroy();
        expect(release).toHaveBeenCalledOnce();
    });

    it("labels the button without the shortcut, leaving that to the keystroke", () => {
        const view = editor.ui.componentFactory.create("internalLink") as { label?: string; keystroke?: string };

        // No dictionary is configured here, so `t()` renders the message id, which is the English
        // label. The shortcut is not part of it — CKEditor appends the keystroke to the tooltip,
        // localized per platform.
        expect(view.label).toBe("Internal link");
        expect(view.keystroke).toBe("CTRL+L");
    });

    it("wires the button to the command (enablement and execution)", () => {
        const view = editor.ui.componentFactory.create("internalLink") as { isEnabled: boolean; fire(name: string): void };
        const command = editor.commands.get(COMMAND_NAME);

        expect(view.isEnabled).toBe(command?.isEnabled);

        const spy = vi.spyOn(editor, "execute");
        view.fire("execute");
        expect(spy).toHaveBeenCalledWith(COMMAND_NAME);
    });

    it("is enabled in a regular paragraph", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(true);
    });

    it("is disabled inside a code block", () => {
        setModelData(editor.model, "<codeBlock language=\"plaintext\">foo[]bar</codeBlock>");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
    });

    it("is disabled when the editor is read-only", () => {
        setModelData(editor.model, "<paragraph>foo[]bar</paragraph>");
        editor.enableReadOnlyMode("test");
        expect(editor.commands.get(COMMAND_NAME)?.isEnabled).toBe(false);
        editor.disableReadOnlyMode("test");
    });
});

describe("the anchors of the document", () => {
    it("lists each name once, sorted, as anchors come and go", async () => {
        const editor = await createTestEditor(
            [ Essentials, Paragraph, Bookmark, InternalLinkPlugin ]
        );
        const zeta = "<bookmark bookmarkId=\"zeta\"></bookmark>";
        setModelData(editor.model, `<paragraph>a${zeta}<bookmark bookmarkId="Alpha"></bookmark>`
            + `[]b${zeta}</paragraph>`);
        expect(getAnchorNames(editor)).toStrictEqual([ "Alpha", "zeta" ]);

        setModelData(editor.model, `<paragraph>a${zeta}[]</paragraph>`);
        expect(getAnchorNames(editor)).toStrictEqual([ "zeta" ]);
    });

    it("lists none in an editor without anchors", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph, InternalLinkPlugin ]);
        expect(getAnchorNames(editor)).toStrictEqual([]);
    });
});

describe("the link at the selection", () => {
    let editor: ClassicEditor;
    let getTitle: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getTitle = vi.fn(async () => "Target");
        editor = await createTestEditor(
            [Essentials, Paragraph, Bold, LinkEditing, LinkEmbedEditing, InternalLinkPlugin],
            { referenceLink: { getTitle, getTitleSync: () => "Target" } }
        );
    });

    const LINKED = "<paragraph>a <$text bold=\"true\" linkHref=\"https://a.example\">fo[]o</$text> b"
        + "</paragraph>";

    it("reads the address and whole text of the link around the caret, and none outside", () => {
        setModelData(editor.model, LINKED);
        expect(getLinkAtSelection(editor))
            .toStrictEqual({ href: "https://a.example", text: "foo", display: "plain" });

        setModelData(editor.model,
            "<paragraph>a[] <$text linkHref=\"https://a.example\">foo</$text></paragraph>");
        expect(getLinkAtSelection(editor)).toBeNull();
        // Nothing to replace there either.
        replaceLinkAtSelection(editor, "#root/abc", "See there");
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe("<paragraph>a <$text linkHref=\"https://a.example\">foo</$text></paragraph>");
    });

    it("reads only the text of a link that holds an inline object", () => {
        editor.model.schema.extend("reference", { allowAttributes: "linkHref" });
        setModelData(editor.model, "<paragraph><$text linkHref=\"https://a.example\">a[]b</$text>"
            + "<reference href=\"#root/abc\" linkHref=\"https://a.example\"></reference>"
            + "<$text linkHref=\"https://a.example\">c</$text></paragraph>");
        expect(getLinkAtSelection(editor))
            .toStrictEqual({ href: "https://a.example", text: "abc", display: "plain" });
    });

    it("reads a selected link preview as a link titled by its title, shown as it is", () => {
        setModelData(editor.model, "<paragraph>a [<linkMention url=\"https://a.example\""
            + " title=\"A\"></linkMention>]</paragraph>");
        expect(getLinkAtSelection(editor))
            .toStrictEqual({ href: "https://a.example", text: "A", display: "inline" });

        setModelData(editor.model,
            "[<linkEmbed url=\"https://a.example\" embedType=\"opengraph\"></linkEmbed>]");
        expect(getLinkAtSelection(editor))
            .toStrictEqual({ href: "https://a.example", text: "", display: "card" });
    });

    it("replaces a selected link preview, in a paragraph of its own for a block one", async () => {
        const data = () => getModelData(editor.model, { withoutSelection: true });
        setModelData(editor.model, "[<linkEmbed url=\"https://a.example\" embedType=\"opengraph\""
            + " title=\"A\"></linkEmbed>]");
        await replaceLinkAtSelection(editor, "https://b.example", "B");
        expect(data())
            .toBe("<paragraph><$text linkHref=\"https://b.example\">B</$text></paragraph>");

        setModelData(editor.model, "<paragraph>a [<linkMention url=\"https://a.example\""
            + " title=\"A\"></linkMention>] b</paragraph>");
        await replaceLinkAtSelection(editor, "#root/abc", null);
        expect(data()).toContain("<paragraph>a <reference href=\"#root/abc\"");
        expect(data()).not.toContain("linkMention");
    });

    it("replaces the address and the text of the whole link, keeping its formatting", () => {
        setModelData(editor.model, LINKED);
        replaceLinkAtSelection(editor, "#root/abc", "See there");
        expect(getModelData(editor.model)).toBe(
            "<paragraph>a <$text bold=\"true\" linkHref=\"#root/abc\">See there[]</$text> b</paragraph>"
        );
    });

    it("turns the link into a reference when it is to mirror the note's title", async () => {
        setModelData(editor.model, LINKED);
        replaceLinkAtSelection(editor, "#root/abc", null);
        const data = () => getModelData(editor.model, { withoutSelection: true });
        await vi.waitFor(() => expect(data()).toContain("<reference href=\"#root/abc\""));
        expect(data()).not.toContain("foo");
    });

    it("makes the reference in one undo step, and none when the title fails to load", async () => {
        setModelData(editor.model, LINKED);
        const data = () => getModelData(editor.model, { withoutSelection: true });
        const original = data();
        await replaceLinkAtSelection(editor, "#root/abc", null);
        expect(data()).toContain("<reference href=\"#root/abc\"");
        editor.execute("undo");
        expect(data()).toBe(original);

        getTitle.mockRejectedValue(new Error("not found"));
        setModelData(editor.model, LINKED);
        const replacing = replaceLinkAtSelection(editor, "#root/abc", null);
        await expect(replacing).rejects.toThrow("not found");
        expect(data()).toBe(original);
    });

    it("puts the caret after the reference, unless it moved while the title loaded", async () => {
        setModelData(editor.model, LINKED);
        await replaceLinkAtSelection(editor, "#root/abc", null);
        expect(getModelData(editor.model)).toMatch(/<\/reference>\[\] b<\/paragraph>$/);

        setModelData(editor.model, LINKED);
        const replacing = replaceLinkAtSelection(editor, "#root/abc", null);
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph) writer.setSelection(paragraph, 0);
        });
        await replacing;
        expect(getModelData(editor.model)).toMatch(/^<paragraph>\[\]a <reference/);
    });

    it("makes no reference once the link is gone by the time the title loads", async () => {
        setModelData(editor.model, LINKED);
        const replacing = replaceLinkAtSelection(editor, "#root/abc", null);
        editor.model.change((writer) => {
            const paragraph = editor.model.document.getRoot()?.getChild(0);
            if (paragraph) writer.remove(paragraph);
        });
        await replacing;
        expect(getModelData(editor.model, { withoutSelection: true })).not.toContain("<reference");
    });
});

describe("the edit button of the link toolbar", () => {
    let editor: ClassicEditor;
    let showDialog: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        showDialog = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, Link, InternalLinkPlugin], {
            internalLink: { showDialog }
        });
    });

    it("opens the Add link dialog in place of the link form, closing the toolbar", () => {
        setModelData(editor.model, "<paragraph><$text linkHref=\"https://a.example\">fo[]o</$text></paragraph>");
        const linkUI = editor.plugins.get(LinkUI);
        const balloon = editor.plugins.get(ContextualBalloon);
        (linkUI as unknown as { _showUI(): void })._showUI();
        const toolbarView = linkUI.toolbarView;
        expect(toolbarView && balloon.hasView(toolbarView)).toBe(true);

        const edit = [...toolbarView?.items ?? []]
            .find((item) => item instanceof ButtonView && item.label === "Edit link");
        expect(edit).toBeInstanceOf(ButtonView);
        edit?.fire("execute");

        expect(showDialog).toHaveBeenCalledOnce();
        expect(toolbarView && balloon.hasView(toolbarView)).toBe(false);
        expect(linkUI.formView && balloon.hasView(linkUI.formView)).toBe(false);
    });
});

describe("the link button and Ctrl+K", () => {
    let editor: ClassicEditor;
    let showDialog: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        showDialog = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, Link, InternalLinkPlugin], {
            internalLink: { showDialog }
        });
    });

    const IN_LINK = "<paragraph><$text linkHref=\"https://a.example\">fo[]o</$text></paragraph>";

    /** Presses Ctrl+K on `keystrokes`, reporting whether a handler took the key. */
    function pressCtrlK(keystrokes: KeystrokeHandler) {
        const preventDefault = vi.fn();
        keystrokes.press({
            keyCode: keyCodes.k, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
            preventDefault, stopPropagation: vi.fn()
        } as unknown as KeyboardEvent);
        return preventDefault.mock.calls.length > 0;
    }

    function isLinkFormShown() {
        const formView = editor.plugins.get(LinkUI).formView;
        return !!formView && editor.plugins.get(ContextualBalloon).hasView(formView);
    }

    it("opens the link dialog on the web link side from the Link button", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        const button = editor.ui.componentFactory.create("link") as ButtonView;
        expect(button.label).toBe("Link");
        expect(button.keystroke).toBe("Ctrl+K");
        expect(button.isOn).toBe(false);

        button.fire("execute");
        expect(showDialog)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: "url" }));
        expect(isLinkFormShown()).toBe(false);

        // The button shows as on in a link, and off where no link can be made.
        setModelData(editor.model, IN_LINK);
        expect(button.isOn).toBe(true);
        editor.enableReadOnlyMode("test");
        expect(button.isEnabled).toBe(false);
    });

    it("opens the link dialog on Ctrl+K in the text", () => {
        setModelData(editor.model, "<paragraph>foo[]</paragraph>");
        expect(pressCtrlK(editor.keystrokes)).toBe(true);
        expect(showDialog)
            .toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: "url" }));
        expect(isLinkFormShown()).toBe(false);
    });

    it("opens the link dialog once on Ctrl+K in the link toolbar, each time it shows", () => {
        setModelData(editor.model, IN_LINK);
        const linkUI = editor.plugins.get(LinkUI);
        const balloon = editor.plugins.get(ContextualBalloon);
        const add = vi.spyOn(balloon, "add");
        const showToolbar = () => (linkUI as unknown as { _showUI(): void })._showUI();

        for (let shown = 1; shown <= 2; shown++) {
            showToolbar();
            const element = linkUI.toolbarView?.element;
            expect(element && balloon.hasView(linkUI.toolbarView)).toBe(true);
            if (!element) return;

            // A DOM event, which both the toolbar and `editor.keystrokes` listen for.
            const keydown = new KeyboardEvent("keydown", {
                keyCode: keyCodes.k, ctrlKey: true, bubbles: true, cancelable: true
            });
            element.dispatchEvent(keydown);
            expect(keydown.defaultPrevented).toBe(true);
            expect(showDialog).toHaveBeenCalledTimes(shown);
            expect(balloon.hasView(linkUI.toolbarView)).toBe(false);
        }
        expect(linkUI.formView).not.toBeNull();
        expect(add.mock.calls.map(([ { view } ]) => view)).not.toContain(linkUI.formView);
    });

    it("keeps the link form of CKEditor in an editor without the link dialog", async () => {
        const plainEditor = await createTestEditor([
            Essentials, Paragraph, Link, InternalLinkPlugin
        ]);
        setModelData(plainEditor.model, "<paragraph>foo[]</paragraph>");
        plainEditor.ui.componentFactory.create("link").fire("execute");

        const formView = plainEditor.plugins.get(LinkUI).formView;
        expect(formView && plainEditor.plugins.get(ContextualBalloon).hasView(formView)).toBe(true);
    });
});
