import {
    ButtonView,
    ClassicEditor,
    Command,
    DropdownView,
    Essentials,
    FileDialogButtonView,
    FileDialogListItemButtonView,
    IconPaperClip,
    ListItemView,
    Paragraph,
    SplitButtonView
} from "ckeditor5";
import bxLink from "boxicons/svg/regular/bx-link.svg?raw";
import bxPen from "boxicons/svg/regular/bx-pen.svg?raw";
import bxShapeSquare from "boxicons/svg/regular/bx-shape-square.svg?raw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import FileUploadUI from "./file_upload_ui.js";

describe("FileUploadUI", () => {
    let editor: ClassicEditor;
    let command: Command;
    let embedCommand: Command;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, FileUploadUI]);
        command = new Command(editor);
        command.refresh();
        editor.commands.add("fileUpload", command);
        embedCommand = new Command(editor);
        embedCommand.refresh();
        editor.commands.add("insertContentEmbed", embedCommand);
    });

    function createDropdown() {
        const dropdown = editor.ui.componentFactory.create("fileUpload");
        if (
            !(dropdown instanceof DropdownView)
            || !(dropdown.buttonView instanceof SplitButtonView)
        ) {
            throw new Error("Expected a split button dropdown.");
        }
        const { actionView } = dropdown.buttonView;
        if (!(actionView instanceof FileDialogButtonView)) {
            throw new Error("Expected a file dialog button as the action.");
        }

        const items = Array.from(dropdown.listView?.items ?? []).map((item) => {
            const button = item instanceof ListItemView ? item.children.first : null;
            if (!(button instanceof FileDialogListItemButtonView)) {
                throw new Error("Expected a file dialog list item.");
            }
            return button;
        });

        return { dropdown, splitButton: dropdown.buttonView, actionView, items };
    }

    function pickFiles() {
        return [
            new File(["a"], "a.pdf", { type: "application/pdf" }),
            new File(["b"], "b.png", { type: "image/png" })
        ];
    }

    it("registers a paperclip split button that picks any number of files of any type", () => {
        const { splitButton, actionView } = createDropdown();

        expect(splitButton.label).toBe("Attach file");
        expect(splitButton.tooltip).toBe(true);
        expect(actionView.label).toBe("Attach file");
        expect(actionView.icon).toBe(IconPaperClip);
        expect(actionView.tooltip).toBe(true);
        expect(actionView.allowMultipleFiles).toBe(true);
        expect(actionView.acceptedType).toBeUndefined();
    });

    it("links the files picked through the button and returns the focus to the editor", () => {
        const { actionView } = createDropdown();
        const execute = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
        const focus = vi.spyOn(editor.editing.view, "focus");
        const files = pickFiles();

        actionView.fire("done", files);

        expect(execute).toHaveBeenCalledWith("fileUpload", { file: files });
        expect(focus).toHaveBeenCalled();
    });

    it("lists attaching as links and as embeds, each closing the dropdown when picked", () => {
        const { dropdown, items } = createDropdown();
        const execute = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
        const focus = vi.spyOn(editor.editing.view, "focus");
        const openDialog = vi.spyOn(HTMLInputElement.prototype, "click")
            .mockImplementation(() => undefined);
        const files = pickFiles();

        expect(items.map((item) => [
            item.label, item.icon, item.withText, item.allowMultipleFiles
        ])).toEqual([
            [ "Attach file as a link", bxLink, true, true ],
            [ "Attach and embed file", bxShapeSquare, true, true ]
        ]);

        const [ linkItem, embedItem ] = items;
        dropdown.render();
        dropdown.isOpen = true;
        linkItem.fire("execute");
        expect(dropdown.isOpen).toBe(false);
        expect(openDialog).toHaveBeenCalledOnce();
        openDialog.mockRestore();

        linkItem.fire("done", files);
        embedItem.fire("done", files);
        expect(execute.mock.calls).toEqual([
            [ "fileUpload", { file: files } ],
            [ "fileUpload", { file: files, asEmbed: true } ]
        ]);
        expect(focus).toHaveBeenCalledTimes(2);
        dropdown.destroy();
    });

    it("follows the `fileUpload` command, and offers embeds only where an embed can go", () => {
        const { dropdown, actionView, items: [ linkItem, embedItem ] } = createDropdown();
        expect([ dropdown.isEnabled, actionView.isEnabled ]).toEqual([ true, true ]);
        expect([ linkItem.isEnabled, embedItem.isEnabled ]).toEqual([ true, true ]);

        embedCommand.forceDisabled("spec");
        expect([ linkItem.isEnabled, embedItem.isEnabled ]).toEqual([ true, false ]);

        command.forceDisabled("spec");
        expect([ dropdown.isEnabled, actionView.isEnabled ]).toEqual([ false, false ]);
    });

    it("builds the button in an editor without the commands, listing no embeds", async () => {
        editor = await createTestEditor([Essentials, Paragraph, FileUploadUI]);

        const labels = createDropdown().items.map((item) => item.label);
        expect(labels).toEqual([ "Attach file as a link" ]);
    });

    describe("drawingCanvas", () => {
        function createCanvasButton() {
            const button = editor.ui.componentFactory.create("drawingCanvas");
            if (!(button instanceof ButtonView)) {
                throw new Error("Expected a button.");
            }
            return button;
        }

        it("embeds an editable empty drawing, medium, untitled and focused, quietly", async () => {
            const button = createCanvasButton();
            const execute = vi.spyOn(editor, "execute").mockImplementation(() => undefined);
            const focus = vi.spyOn(editor.editing.view, "focus");

            expect([ button.label, button.icon, button.tooltip ])
                .toEqual([ "Drawing canvas", bxPen, true ]);

            button.fire("execute");

            expect(execute).toHaveBeenCalledExactlyOnceWith("fileUpload", {
                file: [ expect.any(File) ],
                asEmbed: true,
                boxSize: "medium",
                hideTitle: true,
                editable: true,
                quiet: true,
                focusEmbed: true
            });
            const [ file ] = (execute.mock.calls[0][1] as { file: File[] }).file;
            expect([ file.name, file.type ])
                .toEqual([ "Canvas.excalidraw", "application/vnd.excalidraw+json" ]);
            expect(JSON.parse(await file.text())).toEqual({
                type: "excalidraw", version: 2, elements: [], files: {}, appState: {}
            });
            expect(focus).toHaveBeenCalled();
        });

        it("is enabled only where a file can be attached and an embed can go", async () => {
            const button = createCanvasButton();
            expect(button.isEnabled).toBe(true);

            embedCommand.forceDisabled("spec");
            expect(button.isEnabled).toBe(false);
            embedCommand.clearForceDisabled("spec");
            command.forceDisabled("spec");
            expect(button.isEnabled).toBe(false);

            editor = await createTestEditor([Essentials, Paragraph, FileUploadUI]);
            expect(createCanvasButton().isEnabled).toBe(false);
        });
    });
});
