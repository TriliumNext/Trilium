import {
    _getModelData as getModelData, _getViewData as getViewData, _setModelData as setModelData,
    type ButtonView, type ClassicEditor, ContextualBalloon, FontBackgroundColor, FontColor,
    FontSize, GeneralHtmlSupport, Link, Paragraph
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createTestEditor, getEditorElement } from "../../../test/editor-kit.js";
import { installGlobMock } from "../../../test/globals-test-kit.js";
import ReferenceLink from "../referencelink.js";
import InlineIcon from "./inline_icon.js";
import InlineIconEditing from "./inline_icon_editing.js";
import InlineIconUI from "./inline_icon_ui.js";

describe("InlineIcon", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Paragraph, InlineIcon ]);
    });

    it("loads the glue plugin and its editing/UI parts", () => {
        expect(editor.plugins.get(InlineIcon)).toBeInstanceOf(InlineIcon);
        expect(editor.plugins.get(InlineIconEditing)).toBeInstanceOf(InlineIconEditing);
        expect(editor.plugins.get(InlineIconUI)).toBeInstanceOf(InlineIconUI);
        expect(InlineIcon.pluginName).toBe("InlineIcon");
    });

    it("registers the icon as an inline object that goes wherever text goes", () => {
        const schema = editor.model.schema;
        setModelData(editor.model, "<paragraph>[]</paragraph>");
        const paragraph = editor.model.document.getRoot()?.getChild(0);

        expect({
            isInline: schema.isInline("inlineIcon"),
            isObject: schema.isObject("inlineIcon"),
            inParagraph: !!paragraph && schema.checkChild(paragraph, "inlineIcon"),
            carriesIconClass: schema.checkAttribute("inlineIcon", "iconClass")
        }).toEqual({ isInline: true, isObject: true, inParagraph: true, carriesIconClass: true });
    });

    it("inserts the icon in the form icons take everywhere else, as a widget while editing", () => {
        setModelData(editor.model, "<paragraph>Press []</paragraph>");

        editor.execute("insertIcon", { iconClass: "bx bx-cog" });

        expect(editor.getData()).toBe(`<p>Press&nbsp;<span class="tn-icon bx bx-cog"></span></p>`);
        expect(getViewData(editor.editing.view, { withoutSelection: true }))
            .toBe(`<p>Press <span class="bx bx-cog ck-widget tn-icon"` +
                ` contenteditable="false"></span></p>`);
    });

    it("replaces a selected icon, keeping its colour", () => {
        setModelData(editor.model, `<paragraph>Press [<inlineIcon fontColor="rgb(255,0,0)"`
            + ` iconClass="bx bx-cog bx-rotate-90"></inlineIcon>] now</paragraph>`);

        editor.execute("insertIcon", { iconClass: "bx bx-star" });

        // `fontColor` is copied from the replaced icon; reading it from the caret instead would
        // leave the replacement uncoloured inside a coloured run. The transform is not copied: it
        // is part of `iconClass`, which the new icon supplies.
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>Press <inlineIcon fontColor="rgb(255,0,0)" iconClass="bx bx-star">`
                + `</inlineIcon> now</paragraph>`);
    });

    it("upcasts a stored icon back, keeping the pack's classes and dropping the marker", () => {
        editor.setData(`<p>Press <span class="tn-icon bx bx-cog"></span>.</p>`);

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>Press <inlineIcon iconClass="bx bx-cog"></inlineIcon>.</paragraph>`);
    });

    it("keeps a marked span that names no pack as it found it", () => {
        editor.setData(`<p><span class="tn-icon"></span></p>`);

        expect(editor.getData()).toBe(`<p><span class="tn-icon"></span></p>`);
    });

    it("ignores an insert that names no icon", () => {
        setModelData(editor.model, "<paragraph>[]</paragraph>");

        editor.execute("insertIcon", { iconClass: "  " });

        expect(editor.getData()).toBe("");
    });

    it("disables the command in a place that takes no text", () => {
        const command = editor.commands.get("insertIcon");
        expect(command?.isEnabled).toBe(true);

        editor.enableReadOnlyMode("spec");
        expect(command?.isEnabled).toBe(false);
    });

});

describe("a reference link pasted from a rendered page", () => {
    // The editing view renders a reference link with an icon inside it, so that is what lands on
    // the clipboard. A reference takes no children, so the icon is dropped rather than split out
    // beside the link.
    it("loses the icon the renderer drew inside it, leaving the link alone", async () => {
        installGlobMock({
            getComponentByEl: () => ({ loadReferenceLinkTitle: () => Promise.resolve() }),
            getReferenceLinkTitleSync: () => "Some note",
            getReferenceLinkTitle: async () => "Some note"
        });

        const editor = await createTestEditor([ Paragraph, Link, ReferenceLink, InlineIcon ]);

        editor.setData(`<p>See <a class="reference-link" href="#root/abc">`
            + `<span><span class="tn-icon bx bx-file"></span>Some note</span></a> for more.</p>`);

        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>See <reference href="#root/abc"></reference> for more.</paragraph>`);
    });
});

describe("an icon's colour", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Paragraph, InlineIcon, FontColor, FontBackgroundColor ]);
    });

    it("is the toolbar's to set, and survives the round trip through the note", () => {
        setModelData(editor.model, "<paragraph>a[]b</paragraph>");
        editor.execute("insertIcon", { iconClass: "bx bx-cog" });
        selectTheIcon(editor);

        expect(editor.commands.get("fontColor")?.isEnabled).toBe(true);
        expect(editor.commands.get("fontBackgroundColor")?.isEnabled).toBe(true);

        editor.execute("fontColor", { value: "rgb(255,0,0)" });
        editor.execute("fontBackgroundColor", { value: "rgb(0,255,0)" });

        const stored = `<p>a<span style="background-color:rgb(0,255,0);color:rgb(255,0,0);">`
            + `<span class="tn-icon bx bx-cog"></span></span>b</p>`;
        expect(editor.getData()).toBe(stored);

        editor.setData(stored);
        expect(getModelData(editor.model, { withoutSelection: true }))
            .toBe(`<paragraph>a<inlineIcon fontBackgroundColor="rgb(0,255,0)"`
                + ` fontColor="rgb(255,0,0)" iconClass="bx bx-cog"></inlineIcon>b</paragraph>`);
    });

    it("is the colour of the text it is put into, where that text has one", () => {
        editor.setData(`<p><span style="color:rgb(255,0,0);">red</span></p>`);
        putCaretAtTheEnd(editor);

        editor.execute("insertIcon", { iconClass: "bx bx-cog" });

        // Inside the colour the text already has, rather than beside it in a colour of its own.
        expect(editor.getData()).toBe(`<p><span style="color:rgb(255,0,0);">red`
            + `<span class="tn-icon bx bx-cog"></span></span></p>`);
    });
});

describe("an icon's size", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([ Paragraph, InlineIcon, FontSize ]);
    });

    it("is the toolbar's to set, and leaves the run around it whole", () => {
        editor.setData(`<p>a<span class="tn-icon bx bx-cog"></span>b</p>`);
        selectTheIcon(editor);

        expect(editor.commands.get("fontSize")?.isEnabled).toBe(true);

        editor.execute("fontSize", { value: "big" });
        expect(editor.getData())
            .toBe(`<p>a<span class="text-big"><span class="tn-icon bx bx-cog"></span></span>b</p>`);

        // A line sized as a whole stays one run. An icon that the size cannot apply to splits the
        // run in two and stays between the halves at its original size.
        editor.setData(`<p>a<span class="tn-icon bx bx-cog"></span>b</p>`);
        editor.model.change((writer) => {
            const root = editor.model.document.getRoot();
            if (root) {
                writer.setSelection(writer.createRangeIn(root), "in");
            }
        });

        editor.execute("fontSize", { value: "big" });
        expect(editor.getData())
            .toBe(`<p><span class="text-big">a<span class="tn-icon bx bx-cog"></span>b</span></p>`);
    });

    it("is the size of the text it is put into, where that text has one", () => {
        editor.setData(`<p><span class="text-big">big</span></p>`);
        putCaretAtTheEnd(editor);

        editor.execute("insertIcon", { iconClass: "bx bx-cog" });

        expect(editor.getData()).toBe(`<p><span class="text-big">big`
            + `<span class="tn-icon bx bx-cog"></span></span></p>`);
    });
});

describe("the balloon InlineIcon picks in", () => {
    let editor: ClassicEditor;
    let showIconPicker: Mock<(request: IconPickerRequest) => (() => void) | null>;
    let release: Mock<() => void>;

    beforeEach(async () => {
        release = vi.fn();
        showIconPicker = vi.fn(() => release);
        installGlobMock({ getComponentByEl: () => ({ showIconPicker }) });

        editor = await createTestEditor([ Paragraph, InlineIcon ]);
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    });

    it("hands the host the balloon's own element to paint into", () => {
        pressInsertIcon(editor);

        const balloon = editor.plugins.get(ContextualBalloon);
        const { container } = showIconPicker.mock.calls[0][0];

        expect(balloon.visibleView).not.toBeNull();
        expect(balloon.view.element?.contains(container)).toBe(true);
        // Everything a balloon shows sits inside the body collection's `ck-reset_all`, which would
        // strip the application's own styling from the picker.
        expect(container.classList.contains("ck-reset_all-excluded")).toBe(true);
    });

    it("aims at the caret, read afresh on every placing", () => {
        const balloon = editor.plugins.get(ContextualBalloon);
        setModelData(editor.model, "<paragraph>Hello[] there</paragraph>");

        pressInsertIcon(editor);

        const { target } = balloon.getPositionOptions() ?? {};
        expect(typeof target).toBe("function");

        const caret = typeof target === "function" ? target() : target;
        expect(caret).toBeInstanceOf(Range);
        expect((caret as Range).collapsed).toBe(true);
        expect((caret as Range).startContainer.textContent).toBe("Hello there");
    });

    it("inserts what the host reports, and lets go of the picker", () => {
        pressInsertIcon(editor);

        showIconPicker.mock.calls[0][0].onSelect("bx bx-cog");

        expect(editor.getData()).toBe(`<p><span class="tn-icon bx bx-cog"></span></p>`);
        expect(release).toHaveBeenCalledOnce();
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });

    it("picks over the selected icon when the change button is the one pressed", () => {
        setModelData(
            editor.model,
            `<paragraph>Press [<inlineIcon iconClass="bx bx-cog"></inlineIcon>]</paragraph>`
        );

        pressChangeIcon(editor);
        // The picker points at the icon rather than at a caret, since the icon is what is selected.
        const { target } = editor.plugins.get(ContextualBalloon).getPositionOptions() ?? {};
        const at = typeof target === "function" ? target() : target;

        showIconPicker.mock.calls[0][0].onSelect("bx bx-star");

        expect(editor.getData())
            .toBe(`<p>Press&nbsp;<span class="tn-icon bx bx-star"></span></p>`);
        expect(at).toBeInstanceOf(Range);
        expect((at as Range).collapsed).toBe(false);
        expect(release).toHaveBeenCalledOnce();
    });

    it("takes the balloon back down for a host that shows the picker its own way", () => {
        showIconPicker.mockReturnValue(null);

        pressInsertIcon(editor);

        expect(showIconPicker).toHaveBeenCalledOnce();
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });

    it("lets go of the picker when a click lands outside the balloon", () => {
        pressInsertIcon(editor);

        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        expect(release).toHaveBeenCalledOnce();
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });

    it("lets go of the picker on Esc, from the text and from the picker alike", () => {
        pressInsertIcon(editor);
        const container = showIconPicker.mock.calls[0][0].container;

        // Esc reaches the editor only while the caret has focus; once the picker has taken focus,
        // the key lands on the balloon's own element.
        container.dispatchEvent(escapeKeyDown());
        expect(release).toHaveBeenCalledOnce();
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();

        pressInsertIcon(editor);
        editor.editing.view.getDomRoot()?.dispatchEvent(escapeKeyDown());

        expect(release).toHaveBeenCalledTimes(2);
        expect(editor.plugins.get(ContextualBalloon).visibleView).toBeNull();
    });

    it("leaves the one balloon it has open alone when the button is pressed again", () => {
        pressInsertIcon(editor);
        pressInsertIcon(editor);

        expect(showIconPicker).toHaveBeenCalledOnce();
        expect(release).not.toHaveBeenCalled();
    });

    it("leaves Esc to the rest of the editor while no picker is open", () => {
        const escape = escapeKeyDown();
        editor.editing.view.getDomRoot()?.dispatchEvent(escape);

        expect(escape.defaultPrevented).toBe(false);
        expect(release).not.toHaveBeenCalled();
    });

    it("lets go of the picker when the editor is torn down under it", async () => {
        pressInsertIcon(editor);

        await editor.destroy();

        expect(release).toHaveBeenCalledOnce();
    });
});

describe("where the balloon holding the picker ends up", () => {
    // Real geometry needs the editor's own stylesheet, which the specs otherwise do without: it
    // makes the balloon panel an absolutely positioned box that repositioning can move.
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    beforeEach(() => installPaintingHost());

    it("places itself again once the host has painted, so the arrow finds the caret", async () => {
        const editor = await createTestEditor([ Paragraph, InlineIcon ]);
        getEditorElement(editor).style.cssText = "width: 300px; margin: 200px 0 0 20px;";
        setModelData(editor.model, "<paragraph>Hello[] there</paragraph>");

        pressInsertIcon(editor);

        const balloon = editor.plugins.get(ContextualBalloon);
        const placedWhileEmpty = balloonRect(balloon).left;

        // The observer fires on a later frame, as it does for a host that renders through its own
        // renderer rather than synchronously.
        await new Promise((resolve) => setTimeout(resolve, 100));

        const view = editor.editing.view;
        const range = view.document.selection.getFirstRange();
        if (!range) throw new Error("the caret has no range");
        const caret = view.domConverter.viewRangeToDom(range).getBoundingClientRect();
        const panel = balloonRect(balloon);

        expect(panel.width).toBeGreaterThan(PAINTED_PICKER_WIDTH);
        expect(Math.abs(arrowX(balloon.view.position, panel) - caret.x)).toBeLessThan(20);
        expect(panel.left).not.toBe(placedWhileEmpty);
    });
});

describe("InlineIcon under the shipped General HTML Support configuration", () => {
    // `textNoteHtmlSupportEnabled` ships off, which leaves GHS with an empty allow-list: a span
    // with nothing but classes is dropped unless a plugin models it.
    it("keeps an icon that the plugin models, and loses one that nothing does", async () => {
        const withPlugin = await createTestEditor([ Paragraph, InlineIcon, GeneralHtmlSupport ], {
            htmlSupport: { allow: [] }
        });
        const withoutPlugin = await createTestEditor([ Paragraph, GeneralHtmlSupport ], {
            htmlSupport: { allow: [] }
        });

        const stored = `<p>Press <span class="tn-icon bx bx-cog"></span>.</p>`;

        withPlugin.setData(stored);
        withoutPlugin.setData(stored);

        expect(withPlugin.getData()).toBe(`<p>Press <span class="tn-icon bx bx-cog"></span>.</p>`);
        expect(withoutPlugin.getData()).toBe("<p>Press .</p>");
    });
});

function pressInsertIcon(editor: ClassicEditor) {
    pressPickerButton(editor, "insertIcon");
}

/** The button in the balloon over a selected icon, which opens the same picker. */
function pressChangeIcon(editor: ClassicEditor) {
    pressPickerButton(editor, "changeIcon");
}

function pressPickerButton(editor: ClassicEditor, name: string) {
    const button = editor.ui.componentFactory.create(name) as unknown as ButtonView;
    button.fire("execute");
}

function escapeKeyDown() {
    return new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true });
}

/** How wide the stand-in for the picker is, which the balloon is placed around. */
const PAINTED_PICKER_WIDTH = 260;

/** A host that renders something the picker's size into the element the editor passes it. */
function installPaintingHost() {
    installGlobMock({
        getComponentByEl: () => ({
            showIconPicker({ container }: { container: HTMLElement }) {
                const painted = document.createElement("div");
                painted.style.cssText = `width: ${PAINTED_PICKER_WIDTH}px; height: 400px;`;
                container.appendChild(painted);

                return () => painted.remove();
            }
        })
    });
}

function balloonRect(balloon: ContextualBalloon) {
    const element = balloon.view.element;
    if (!element) {
        throw new Error("the balloon has no element");
    }

    return element.getBoundingClientRect();
}

/** Where the theme puts the arrow: centred for `arrow_n`/`arrow_s`, else 16px in from an edge. */
function arrowX(position: string | undefined, panel: DOMRect) {
    if (position?.endsWith("_nw") || position?.endsWith("_sw")) {
        return panel.left + 16;
    }
    if (position?.endsWith("_ne") || position?.endsWith("_se")) {
        return panel.right - 16;
    }

    return panel.left + panel.width / 2;
}

/** Puts the selection on the icon in the first paragraph, as a click on the widget would. */
function selectTheIcon(editor: ClassicEditor) {
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("the document holds no paragraph");
        }

        const icon = paragraph.getChild(1);
        if (!icon) {
            throw new Error("the paragraph holds no icon");
        }

        writer.setSelection(writer.createRangeOn(icon));
    });
}

function putCaretAtTheEnd(editor: ClassicEditor) {
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("the document holds no paragraph");
        }

        writer.setSelection(writer.createPositionAt(paragraph, "end"));
    });
}
