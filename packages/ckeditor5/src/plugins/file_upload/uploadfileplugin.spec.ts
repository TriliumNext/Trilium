import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Uploadfileplugin from "./uploadfileplugin.js";

describe("Uploadfileplugin", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Uploadfileplugin]);
    });

    it("loads the plugin and its required FileUploadEditing dependency", () => {
        expect(editor.plugins.get(Uploadfileplugin)).toBeInstanceOf(Uploadfileplugin);
    });

    it("has the correct pluginName", () => {
        expect(Uploadfileplugin.pluginName).toBe("fileUploadPlugin");
    });

    it("declares FileUploadEditing as a required plugin", () => {
        const requires = Uploadfileplugin.requires;
        expect(requires).toHaveLength(1);
        const FileUploadEditing = requires[0];
        expect(editor.plugins.has(FileUploadEditing as never)).toBe(true);
    });
});
