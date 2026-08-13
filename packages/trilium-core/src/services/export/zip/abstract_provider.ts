import { imageExtensionForMime, imageMimeForExtension, isAcceptedImageMime, NoteType } from "@triliumnext/commons";
import mimeTypes from "mime-types";

import type BBranch from "../../../becca/entities/bbranch.js";
import type BNote from "../../../becca/entities/bnote.js";
import { ExportFormat, NoteMeta, NoteMetaFile } from "../../../meta.js";
import type { ZipArchive } from "../../zip_provider.js";
import { mapCodeMimeToExtension } from "../single.js";

type RewriteLinksFn = (content: string, noteMeta: NoteMeta) => string;

export interface AdvancedExportOptions {
    /**
     * If `true`, then only the note's content will be kept. If `false` (default), then each page will have its own <html> template.
     */
    skipHtmlTemplate?: boolean;

    skipExtraFiles?: boolean;

    /**
     * Provides a custom function to rewrite the links found in HTML or Markdown notes. This method is called for every note imported, if it's of the right type.
     *
     * @param originalRewriteLinks the original rewrite links function. Can be used to access the default behaviour without having to reimplement it.
     * @param getNoteTargetUrl the method to obtain a note's target URL, used internally by `originalRewriteLinks` but can be used here as well.
     * @returns a function to rewrite the links in HTML or Markdown notes.
     */
    customRewriteLinks?: (originalRewriteLinks: RewriteLinksFn, getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null) => RewriteLinksFn;
}

export interface ZipExportProviderData {
    branch: BBranch;
    getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null;
    archive: ZipArchive;
    zipExportOptions: AdvancedExportOptions | undefined;
    rewriteFn: RewriteLinksFn;
}

export abstract class ZipExportProvider {
    branch: BBranch;
    getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null;
    archive: ZipArchive;
    zipExportOptions?: AdvancedExportOptions;
    rewriteFn: RewriteLinksFn;

    constructor(data: ZipExportProviderData) {
        this.branch = data.branch;
        this.getNoteTargetUrl = data.getNoteTargetUrl;
        this.archive = data.archive;
        this.zipExportOptions = data.zipExportOptions;
        this.rewriteFn = data.rewriteFn;
    }

    abstract prepareMeta(metaFile: NoteMetaFile): void;
    abstract prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta, note: BNote | undefined, branch: BBranch): string | Uint8Array;
    abstract afterDone(rootMeta: NoteMeta): void;

    /**
     * Determines the extension of the resulting file for a specific note type.
     *
     * @param type the type of the note.
     * @param mime the mime type of the note.
     * @param existingExtension the existing extension, including the leading period character.
     * @param format the format requested for export (e.g. HTML, Markdown).
     * @returns an extension *without* the leading period character, or `null` to preserve the existing extension instead.
     */
    mapExtension(type: NoteType | null, mime: string, existingExtension: string, format: ExportFormat) {
        // the following two are handled specifically since we always want to have these extensions no matter the automatic detection
        // and/or existing detected extensions in the note name
        if (type === "text" && format === "markdown") {
            return "md";
        } else if (type === "text" && format === "html") {
            return "html";
        } else if (mime === "application/x-javascript" || mime === "text/javascript") {
            return "js";
        } else if (type === "canvas" || mime === "application/json") {
            return "json";
        }

        const pictureExtension = pictureExtensionFor(mime);

        if (pictureExtension) {
            // A picture is named after its media type rather than after its title, that being the
            // only way round which survives the upload having converted it. An image compressed
            // from PNG to JPEG keeps the title it arrived under — an attachment is never renamed,
            // a canvas addressing its images by title being the reason — while its mime follows
            // the new bytes. Take the title's word for it and a JPEG is written to a `.png` name,
            // which every reader downstream then believes.
            //
            // Only a real disagreement is worth renaming over: `.jpg` and `.jpeg` are one format
            // under either spelling of the media type, and the case of an extension means nothing.
            const titleExtension = existingExtension && pictureExtensionFor(imageMimeForExtension(existingExtension));

            return titleExtension === pictureExtension ? null : pictureExtension;
        }

        if (existingExtension.length > 0) {
            // Outside pictures the title tends to be the better informed of the two, so it keeps
            // the last word: a mermaid source is named `.mmd` far more usefully than the `.txt`
            // its media type maps to.
            return null;
        }

        if (mime?.toLowerCase()?.trim() === "text/mermaid") {
            return "txt";
        }
        return mapCodeMimeToExtension(mime) || mimeTypes.extension(mime) || "dat";


    }

}

/**
 * The extension a picture of this media type is written with, or null where it is not a picture.
 *
 * Trims and lowercases first, so the reading survives a media type stored untidily, and answers
 * for one spelling of a format exactly as it does for the other.
 */
function pictureExtensionFor(mime: string): string | null {
    const normalized = mime?.trim().toLowerCase() ?? "";

    return isAcceptedImageMime(normalized) ? imageExtensionForMime(normalized) : null;
}
