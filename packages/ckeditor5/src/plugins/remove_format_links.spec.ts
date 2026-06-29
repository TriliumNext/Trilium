import { ClassicEditor, Essentials, Link, Paragraph, RemoveFormat } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import RemoveFormatLinksPlugin from "./remove_format_links.js";

describe("RemoveFormatLinksPlugin", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Link, RemoveFormat, RemoveFormatLinksPlugin]);
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
    });
});
