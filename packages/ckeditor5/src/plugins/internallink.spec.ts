import {
    _getModelData as getModelData, _setModelData as setModelData, Bold, ButtonView, ClassicEditor, CodeBlock,
    ContextualBalloon, Essentials, Link, LinkEditing, LinkUI, Paragraph
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import InternalLinkPlugin, {
    COMMAND_NAME, getLinkAtSelection, replaceLinkAtSelection
} from "./internallink.js";

describe("InternalLinkPlugin", () => {
    let editor: ClassicEditor;
    let openDialog: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        openDialog = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, CodeBlock, InternalLinkPlugin], {
            internalLink: { openDialog }
        });
    });

    it("loads the plugin and registers the command and toolbar button", () => {
        expect(editor.plugins.get(InternalLinkPlugin)).toBeInstanceOf(InternalLinkPlugin);
        expect(editor.commands.get(COMMAND_NAME)).toBeDefined();
        expect(editor.ui.componentFactory.has("internalLink")).toBe(true);
    });

    it("has the host open the Add link dialog when executed", () => {
        editor.execute(COMMAND_NAME);
        expect(openDialog).toHaveBeenCalledOnce();
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

describe("the link at the selection", () => {
    let editor: ClassicEditor;
    let getTitle: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        getTitle = vi.fn(async () => "Target");
        editor = await createTestEditor([Essentials, Paragraph, Bold, LinkEditing, InternalLinkPlugin], {
            referenceLink: { getTitle, getTitleSync: () => "Target" }
        });
    });

    const LINKED = "<paragraph>a <$text bold=\"true\" linkHref=\"https://a.example\">fo[]o</$text> b"
        + "</paragraph>";

    it("reads the address and whole text of the link around the caret, and none outside", () => {
        setModelData(editor.model, LINKED);
        expect(getLinkAtSelection(editor)).toStrictEqual({ href: "https://a.example", text: "foo" });

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
        expect(getLinkAtSelection(editor)).toStrictEqual({ href: "https://a.example", text: "abc" });
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
    let openDialog: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        openDialog = vi.fn();
        editor = await createTestEditor([Essentials, Paragraph, Link, InternalLinkPlugin], {
            internalLink: { openDialog }
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

        expect(openDialog).toHaveBeenCalledOnce();
        expect(toolbarView && balloon.hasView(toolbarView)).toBe(false);
        expect(linkUI.formView && balloon.hasView(linkUI.formView)).toBe(false);
    });
});
