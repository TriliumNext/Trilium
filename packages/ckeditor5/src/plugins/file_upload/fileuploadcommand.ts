import {
    Command,
    FileRepository,
    findOptimalInsertionRange,
    type Editor,
    type FileLoader,
    type Model,
    type ModelWriter
} from "ckeditor5";

import type { BoxSizeValue } from "../content_embed/content_embed.js";
import { uploadAsLink } from "../uploadimage.js";

export interface FileUploadOptions {
    file: File[];
    /** Embeds each file in a block of its own instead of linking it. */
    asEmbed?: boolean;
    /** The box size of the embeds, instead of the one the host picks for the file type. */
    boxSize?: BoxSizeValue;
    /** Hides the title row of the embeds. */
    hideTitle?: boolean;
    /** Turns on the Editable toggle of the embeds, for content that has an editable mode. */
    editable?: boolean;
    /** Skips the `upload` event, for a file that the editor created itself. */
    quiet?: boolean;
    /**
     * Gives the focus to what the embeds show, once the upload ends. The embeds go beside the
     * block of the selection, as an image does, and the cursor stays where the selection starts.
     */
    focusEmbed?: boolean;
}

const quietLoaders = new WeakSet<FileLoader>();
const focusLoaders = new WeakSet<FileLoader>();

/** Whether the upload of `loader` is left out of the `upload` event. */
export function isQuietUpload(loader: FileLoader) {
    return quietLoaders.has(loader);
}

/** Whether the embed of the upload of `loader` takes the focus once the upload ends. */
export function isFocusUpload(loader: FileLoader) {
    return focusLoaders.has(loader);
}

/**
 * Uploads files as attachments of the note and inserts a reference link to each, separated by
 * spaces. Pictures are linked too, rather than shown. With `asEmbed`, each file is embedded
 * instead.
 */
export default class FileUploadCommand extends Command {
    override refresh() {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();

        this.isEnabled = !!position && model.schema.checkChild(position, "reference");
    }

    override execute(options: FileUploadOptions) {
        const { file: files, asEmbed, boxSize, hideTitle, editable, quiet, focusEmbed } = options;
        const model = this.editor.model;
        const fileRepository = this.editor.plugins.get(FileRepository);

        model.change((writer) => {
            for (const file of files) {
                // `createLoader()` logs an error and returns null when no upload adapter is set.
                const loader = fileRepository.createLoader(file);
                if (!loader) {
                    continue;
                }

                uploadAsLink(loader);
                if (quiet) {
                    quietLoaders.add(loader);
                }
                if (focusEmbed) {
                    focusLoaders.add(loader);
                }

                if (asEmbed) {
                    insertEmbedPlaceholder(writer, model, loader.id, file.name, {
                        boxSize: boxSize ?? getEmbedBoxSize(this.editor, file),
                        hideTitle,
                        editable,
                        isBesideSelection: focusEmbed
                    });
                } else {
                    insertPlaceholder(writer, model, loader.id, file.name);
                }
            }
        });
    }
}

/** Inserts the link `FileUploadEditing` completes once the upload ends, and a space after it. */
function insertPlaceholder(writer: ModelWriter, model: Model, uploadId: string, fileName: string) {
    const placeholder = writer.createElement("reference", {
        href: "",
        uploadId,
        uploadFileName: fileName
    });
    model.insertContent(placeholder, model.document.selection);

    const afterPlaceholder = writer.createPositionAfter(placeholder);
    writer.insertText(" ", afterPlaceholder);
    writer.setSelection(afterPlaceholder.getShiftedBy(1));
}

/** Inserts the embed `FileUploadEditing` completes once the upload ends, as a block of its own. */
function insertEmbedPlaceholder(
    writer: ModelWriter,
    model: Model,
    uploadId: string,
    fileName: string,
    { boxSize, hideTitle, editable, isBesideSelection }: EmbedPlaceholderOptions
) {
    const placeholder = writer.createElement("contentEmbed", {
        boxSize,
        ...(hideTitle ? { hideTitle: true } : {}),
        ...(editable ? { editable: true } : {}),
        uploadId,
        uploadFileName: fileName
    });
    if (isBesideSelection) {
        const selection = model.document.selection;
        model.insertObject(placeholder, findOptimalInsertionRange(selection, model));
        writer.setSelection(selection.getFirstPosition());
    } else {
        model.insertObject(placeholder, model.document.selection, null, { setSelection: "after" });
    }
}

interface EmbedPlaceholderOptions {
    boxSize: string;
    hideTitle?: boolean;
    editable?: boolean;
    /** Places the embed beside the block of the selection, which collapses to its start. */
    isBesideSelection?: boolean;
}

/** The box size the host gives an embed of `file`, `medium` when the host does not say. */
function getEmbedBoxSize(editor: Editor, file: File) {
    const component = glob.getComponentByEl<EditorComponent>(editor.editing.view.getDomRoot());
    return component.getEmbedBoxSize?.(file.type, file.size) ?? "medium";
}
