import { NoteType } from "@triliumnext/commons";
import { Archiver } from "archiver";
import mimeTypes from "mime-types";

import type BBranch from "../../../becca/entities/bbranch.js";
import type BNote from "../../../becca/entities/bnote.js";
import type { default as NoteMeta, NoteMetaFile } from "../../meta/note_meta.js";

type RewriteLinksFn = (content: string, noteMeta: NoteMeta) => string;

export type ExportFormat = "html" | "markdown" | "share";

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
    archive: Archiver;
    zipExportOptions: AdvancedExportOptions | undefined;
    rewriteFn: RewriteLinksFn;
}

export abstract class ZipExportProvider {
    branch: BBranch;
    getNoteTargetUrl: (targetNoteId: string, sourceMeta: NoteMeta) => string | null;
    archive: Archiver;
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
    abstract prepareContent(title: string, content: string | Buffer, noteMeta: NoteMeta, note: BNote | undefined, branch: BBranch): string | Buffer;
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
        } else if (existingExtension.length > 0) {
            // if the page already has an extension, then we'll just keep it
            return null;
        }
        if (mime?.toLowerCase()?.trim() === "image/jpg") {
            return "jpg";
        } else if (mime?.toLowerCase()?.trim() === "text/mermaid") {
            return "txt";
        }
        return mimeTypes.extension(mime) || "dat";


    }

}
