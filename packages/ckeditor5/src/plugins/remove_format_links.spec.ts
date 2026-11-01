import { Bold, ClassicEditor, Essentials, Link, Paragraph, RemoveFormat, _getModelData, _setModelData } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import RemoveFormatLinksPlugin from "./remove_format_links.js";

describe("RemoveFormatLinksPlugin", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Bold, Link, RemoveFormat, RemoveFormatLinksPlugin]);
    });

    it("registers itself as a plugin", () => {
        expect(editor.plugins.get(RemoveFormatLinksPlugin)).toBeInstanceOf(RemoveFormatLinksPlugin);
    });

    it("declares RemoveFormat as a required dependency", () => {
        expect(RemoveFormatLinksPlugin.requires).toContain(RemoveFormat);
    });

    it("marks the linkHref attribute as formatting so RemoveFormat strips it", () => {
        const props = editor.model.schema.getAttributeProperties("linkHref");
        expect(props.isFormatting).toBe(true);

        _setModelData(editor.model, '<paragraph>[<$text linkHref="https://google.com">link</$text>]</paragraph>');
        editor.execute("removeFormat");

        expect(_getModelData(editor.model)).toBe("<paragraph>[link]</paragraph>");
    });

    describe("clearing the link once a deletion empties the block (#10613)", () => {
        it("drops linkHref when the deleted selection was the whole block", () => {
            _setModelData(
                editor.model,
                '<paragraph>[<$text linkHref="https://google.com">https://google.com</$text>]</paragraph>' +
                    "<paragraph>after</paragraph>"
            );

            editor.execute("delete");

            // Neither the selection nor the emptied block may keep the link: without the fix the
            // block retained a stored `selection:linkHref` and typing continued the old link.
            expect(editor.model.document.selection.hasAttribute("linkHref")).toBe(false);
            expect(_getModelData(editor.model)).toBe("<paragraph>[]</paragraph><paragraph>after</paragraph>");
        });

        it("still restores genuine formatting (bold) after the same deletion", () => {
            _setModelData(editor.model, "<paragraph>[<$text bold='true'>bold text</$text>]</paragraph>");

            editor.execute("delete");

            expect(editor.model.document.selection.hasAttribute("bold")).toBe(true);
        });

        it("keeps linkHref when the deletion leaves the block non-empty", () => {
            _setModelData(
                editor.model,
                '<paragraph><$text linkHref="https://google.com">ab[cd]ef</$text></paragraph>'
            );

            editor.execute("delete");

            expect(editor.model.document.selection.hasAttribute("linkHref")).toBe(true);
        });

        it("ignores deletions of unlinked content", () => {
            _setModelData(editor.model, "<paragraph>[plain]</paragraph>");

            editor.execute("delete");

            expect(editor.model.document.selection.hasAttribute("linkHref")).toBe(false);
            expect(_getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
        });

        it("ignores deleteContent() driven by a selection other than the document one", () => {
            _setModelData(
                editor.model,
                '<paragraph>[<$text linkHref="https://google.com">link</$text>]</paragraph>' +
                    "<paragraph>second</paragraph>"
            );

            // A detached selection over the *second* paragraph leaves the document selection
            // expanded over the link, so the handler must not touch it.
            editor.model.change((writer) => {
                const second = editor.model.document.getRoot()?.getChild(1);
                if (second) {
                    editor.model.deleteContent(writer.createSelection(second, "in"));
                }
            });

            expect(editor.model.document.selection.hasAttribute("linkHref")).toBe(true);
        });
    });
});
