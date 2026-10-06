import {
    CANVAS_ATTACHMENT_MIME,
    CANVAS_ATTACHMENT_TITLE,
    EMPTY_CANVAS_CONTENT
} from "@triliumnext/commons";
import {
    ButtonView,
    createDropdown,
    FileDialogButtonView,
    FileDialogListItemButtonView,
    IconPaperClip,
    ListItemView,
    ListView,
    Plugin,
    SplitButtonView,
    type Editor,
    type FileInputViewDoneEvent,
    type Locale
} from "ckeditor5";
import bxLink from "boxicons/svg/regular/bx-link.svg?raw";
import bxPen from "boxicons/svg/regular/bx-pen.svg?raw";
import bxShapeSquare from "boxicons/svg/regular/bx-shape-square.svg?raw";

import type { FileUploadOptions } from "./fileuploadcommand.js";

/**
 * Registers the `fileUpload` split button. The button attaches the picked files and links them;
 * the list also offers to embed them.
 *
 * Also registers the `drawingCanvas` button, which attaches an empty canvas drawing and embeds it,
 * editable.
 */
export default class FileUploadUI extends Plugin {
    static get pluginName() {
        return "FileUploadUI" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.ui.componentFactory.add("fileUpload", (locale) => {
            const actionView = new FileDialogButtonView(locale);
            actionView.set({
                label: t("Attach file"),
                icon: IconPaperClip,
                tooltip: true,
                allowMultipleFiles: true
            });
            this.attachOnDone(actionView, {});

            const dropdownView = createDropdown(locale, new SplitButtonView(locale, actionView));
            dropdownView.buttonView.set({ label: t("Attach file"), tooltip: true });
            actionView.bind("isEnabled").to(dropdownView);

            const command = editor.commands.get("fileUpload");
            if (command) {
                dropdownView.bind("isEnabled").to(command);
            }

            const buttons = [
                this.createListButton(locale, t("Attach file as a link"), bxLink, {})
            ];

            // Embedding goes wherever the "Include note" button can insert an embed.
            const embedCommand = editor.commands.get("insertContentEmbed");
            if (embedCommand) {
                const embedButton = this.createListButton(
                    locale, t("Attach and embed file"), bxShapeSquare, { asEmbed: true }
                );
                embedButton.bind("isEnabled").to(embedCommand);
                buttons.push(embedButton);
            }

            const listView = dropdownView.listView = new ListView(locale);
            for (const button of buttons) {
                const listItem = new ListItemView(locale);
                listItem.children.add(button);
                listView.items.add(listItem);
                button.delegate("execute").to(dropdownView);
            }
            dropdownView.panelView.children.add(listView);

            return dropdownView;
        });

        editor.ui.componentFactory.add("drawingCanvas", (locale) => {
            const button = new ButtonView(locale);
            button.set({ label: t("Drawing canvas"), icon: bxPen, tooltip: true });

            const uploadCommand = editor.commands.get("fileUpload");
            const embedCommand = editor.commands.get("insertContentEmbed");
            if (uploadCommand && embedCommand) {
                button.bind("isEnabled").to(uploadCommand, "isEnabled", embedCommand, "isEnabled",
                    (canUpload, canEmbed) => canUpload && canEmbed);
            } else {
                button.isEnabled = false;
            }

            button.on("execute", () => insertDrawingCanvas(editor));

            return button;
        });
    }

    private createListButton(
        locale: Locale,
        label: string,
        icon: string,
        options: Partial<FileUploadOptions>
    ) {
        const button = new FileDialogListItemButtonView(locale);
        button.set({ label, icon, withText: true, allowMultipleFiles: true });
        this.attachOnDone(button, options);

        return button;
    }

    /** Attaches the files picked through `button`, and returns the focus to the editor. */
    private attachOnDone(
        button: FileDialogButtonView | FileDialogListItemButtonView,
        options: Partial<FileUploadOptions>
    ) {
        const editor = this.editor;

        button.on<FileInputViewDoneEvent>("done", (_evt, files) => {
            editor.execute("fileUpload", { file: Array.from(files), ...options });
            editor.editing.view.focus();
        });
    }
}

/**
 * Attaches an empty canvas drawing and embeds it, editable and untitled, with the focus in it, as
 * the `drawingCanvas` button does.
 */
export function insertDrawingCanvas(editor: Editor) {
    const file = new File([ EMPTY_CANVAS_CONTENT ], CANVAS_ATTACHMENT_TITLE, {
        type: CANVAS_ATTACHMENT_MIME
    });
    editor.execute("fileUpload", {
        file: [ file ],
        asEmbed: true,
        boxSize: "medium",
        hideTitle: true,
        editable: true,
        quiet: true,
        focusEmbed: true
    });
    editor.editing.view.focus();
}
