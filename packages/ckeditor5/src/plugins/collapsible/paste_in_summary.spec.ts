import {
    BlockQuote, Bold, ClassicEditor, Essentials, Heading, List, Paragraph, Table, Undo,
    _getModelData as getModelData, _setModelData as setModelData
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CollapsibleEditing from "./collapsible_editing.js";

describe("inserting content into a title", () => {
    let domElement: HTMLDivElement;
    let editor: ClassicEditor;
    let model: ClassicEditor["model"];

    beforeEach(async () => {
        domElement = document.createElement("div");
        document.body.appendChild(domElement);
        editor = await ClassicEditor.create(domElement, {
            licenseKey: "GPL",
            plugins: [
                Essentials, Undo, Paragraph, Bold, Heading, List, BlockQuote, Table,
                CollapsibleEditing
            ]
        });
        model = editor.model;
    });

    afterEach(() => {
        domElement.remove();
        return editor.destroy();
    });

    /** Paste `html`, the way ClipboardPipeline hands dropped or pasted content to the model. */
    const paste = (html: string) => {
        model.insertContent(editor.data.toModel(editor.data.htmlProcessor.toView(html)));
    };

    const withCaretInTitle = () => setModelData(model,
        "<details open=\"true\"><summary>Ti[]tle</summary><paragraph>body</paragraph></details>"
    );

    it("keeps a single pasted block in the title, with its inline formatting", () => {
        withCaretInTitle();

        paste("<p>pas<strong>ted</strong></p>");

        expect(getModelData(model)).toBe(
            "<details open=\"true\">" +
                "<summary>Tipas<$text bold=\"true\">ted[]</$text>tle</summary>" +
                "<paragraph>body</paragraph>" +
            "</details>"
        );
    });

    it("flattens several pasted blocks into the title, one space per block boundary", () => {
        withCaretInTitle();

        // Without the guard the second paragraph — and the rest of the title with it —
        // would be split out of the <summary> and into the body.
        paste("<p>one</p><p>two</p><ul><li>three</li></ul><blockquote><p>four</p></blockquote>");

        expect(getModelData(model)).toBe(
            "<details open=\"true\">" +
                "<summary>Tione two three four[]tle</summary>" +
                "<paragraph>body</paragraph>" +
            "</details>"
        );
    });

    it("drops a pasted block object, which a title cannot show", () => {
        withCaretInTitle();

        paste("<p>before</p><table><tr><td>cell</td></tr></table>");

        expect(getModelData(model)).toBe(
            "<details open=\"true\">" +
                "<summary>Tibefore[]tle</summary>" +
                "<paragraph>body</paragraph>" +
            "</details>"
        );
    });

    it("takes the whole paste back on one undo", () => {
        withCaretInTitle();

        paste("<p>one</p><p>two</p>");
        editor.execute("undo");

        expect(getModelData(model)).toBe(
            "<details open=\"true\"><summary>Ti[]tle</summary><paragraph>body</paragraph></details>"
        );
    });

    it("replaces a selection that stays inside the title", () => {
        setModelData(model,
            "<details open=\"true\"><summary>Ti[tl]e</summary><paragraph>body</paragraph></details>"
        );

        paste("<p>one</p><p>two</p>");

        expect(getModelData(model)).toBe(
            "<details open=\"true\">" +
                "<summary>Tione two[]e</summary>" +
                "<paragraph>body</paragraph>" +
            "</details>"
        );
    });

    it("applies to any insertion into a title, not only a paste", () => {
        withCaretInTitle();

        // A single element inserted at an explicit position — the shape features other
        // than the clipboard use.
        model.change(writer => {
            const paragraph = writer.createElement("paragraph");
            writer.insertText("added", paragraph, 0);
            const summary = model.document.getRoot()?.getChild(0)?.getChild(0);
            model.insertContent(paragraph, writer.createPositionAt(summary, "end"));
        });

        expect(getModelData(model)).toBe(
            "<details open=\"true\">" +
                "<summary>Ti[]tleadded</summary>" +
                "<paragraph>body</paragraph>" +
            "</details>"
        );
    });

    it("leaves an insertion in the body alone", () => {
        setModelData(model,
            "<details open=\"true\"><summary>Title</summary><paragraph>bo[]dy</paragraph></details>"
        );

        paste("<p>one</p><p>two</p>");

        expect(getModelData(model)).toBe(
            "<details open=\"true\"><summary>Title</summary>" +
                "<paragraph>boone</paragraph><paragraph>two[]dy</paragraph>" +
            "</details>"
        );
    });

    it("leaves a selection running out of the title to CKEditor", () => {
        setModelData(model,
            "<details open=\"true\"><summary>Ti[tle</summary><paragraph>bo]dy</paragraph></details>"
        );

        paste("<p>one</p>");

        // CKEditor's own `deleteContent` merged the surviving "dy" into the title first,
        // then the single pasted block merged in at the caret.
        expect(getModelData(model)).toBe(
            "<details open=\"true\"><summary>Tione[]dy</summary><paragraph></paragraph></details>"
        );
    });
});
