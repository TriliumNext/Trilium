import { ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import FileUploadUI from "./file_upload_ui.js";
import FileUploadEditing from "./fileuploadediting.js";
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

    it("loads the editing and the UI plugins", () => {
        expect(Uploadfileplugin.requires).toEqual([ FileUploadEditing, FileUploadUI ]);
        expect(editor.plugins.has(FileUploadEditing)).toBe(true);
        expect(editor.plugins.has(FileUploadUI)).toBe(true);
    });
});
