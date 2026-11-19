import {
    type BlockIdReport, collectBlocks, compareBlockIds, type ConvertNoteFormatResponse,
    type NoteConversionId
} from "@triliumnext/commons";
import { renderToHtml as renderMarkdown } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { t } from "i18next";

import { ValidationError } from "../errors.js";
import mdExportService from "./export/markdown.js";
import markdownImportService, { serverBlockHost } from "./import/markdown.js";
import { getLog } from "./log.js";
import noteService from "./notes.js";
import { sanitizeHtml } from "./sanitizer.js";
import { getSql } from "./sql/index.js";
import type BNote from "../becca/entities/bnote.js";

/** The MIME used for the Markdown note type, matching the note-type registry (`NOTE_TYPES`). */
const MARKDOWN_TARGET_MIME = "text/x-markdown";

type SourceFormat = "html" | "markdown";

interface NoteConversion {
    /** Whether `note` is the expected source type for this conversion. */
    appliesTo: (note: BNote) => boolean;
    sourceFormat: SourceFormat;
}

/**
 * Registry of the available directed conversions, keyed by the id shared with the client via
 * `@triliumnext/commons`. To add a conversion, add its id to `NOTE_CONVERSION_IDS` in commons and
 * an entry here (plus the option label on the client).
 */
export const NOTE_CONVERSIONS: Record<NoteConversionId, NoteConversion> = {
    htmlToMarkdown: {
        appliesTo: (note) => note.type === "text",
        sourceFormat: "html"
    },
    markdownToHtml: {
        appliesTo: (note) => note.isMarkdown(),
        sourceFormat: "markdown"
    }
};

interface ConversionResult extends BlockIdReport {
    content: string;
    type: "text" | "code";
    mime: string;
}

/** Wikilinks become links into the tree, which create backlinks and reach the blocks they name. */
const WIKILINK_TO_TREE = { formatHref: (noteId: string) => `#root/${noteId}` };

/**
 * Pure content + type transform between an HTML text note and a Markdown code note. Block ids go
 * along as block markers, and the result reports the ids that did not reach the same block.
 *
 * The direction is determined by `sourceFormat`. This function holds no Becca state, so it
 * can be unit-tested directly. The orchestration (revision, persistence) lives in
 * {@link convertNoteFormat}.
 */
export function convertNoteContent(sourceFormat: SourceFormat, content: string, title: string): ConversionResult {
    if (sourceFormat === "html") {
        const markdown = mdExportService.toMarkdown(content, { blockIds: "markers" });
        const renderedBack = markdownImportService.renderToHtml(markdown, title, {
            wikiLink: WIKILINK_TO_TREE
        });
        return {
            content: markdown,
            type: "code",
            mime: MARKDOWN_TARGET_MIME,
            ...compareBlockIds(collectHtmlBlocks(content), collectHtmlBlocks(renderedBack))
        };
    }

    const html = markdownImportService.renderToHtml(content, title, { wikiLink: WIKILINK_TO_TREE });
    const shown = renderMarkdown(content, title, { sanitize: sanitizeHtml, demoteH1: false });
    return {
        content: html,
        type: "text",
        mime: "text/html",
        ...compareBlockIds(collectHtmlBlocks(shown), collectHtmlBlocks(html))
    };
}

function collectHtmlBlocks(html: string) {
    return collectBlocks(serverBlockHost.parse(html));
}

/**
 * Converts a note in place between an HTML text note and a Markdown code note.
 *
 * The direction is inferred from the note's current type. A named revision capturing the
 * pre-conversion state is saved first, so the conversion — which is lossy in the HTML→Markdown
 * direction — remains reversible.
 *
 * Must be called within a CLS context (Express routes already provide one).
 */
export function convertNoteFormat(note: BNote): ConvertNoteFormatResponse {
    const isMarkdown = note.isMarkdown();

    if (note.type !== "text" && !isMarkdown) {
        throw new ValidationError(`Note '${note.noteId}' of type '${note.type}' cannot be converted between HTML and Markdown.`);
    }

    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note '${note.noteId}' content is not available; a protected session may be required.`);
    }

    const report = performConversion(note, isMarkdown ? "markdown" : "html");

    return { type: isMarkdown ? "text" : "code", ...report };
}

/**
 * Applies a specific directed conversion (from the {@link NOTE_CONVERSIONS} registry) to a note,
 * used by the `convertNote` bulk action. The note is left untouched (silently skipped) if it is
 * not the expected source type or its content is unavailable, so a batch can target a mixed set.
 */
export function convertNoteByConversionId(note: BNote, conversionId: string): boolean {
    const conversion = NOTE_CONVERSIONS[conversionId as NoteConversionId];

    if (!conversion || !conversion.appliesTo(note) || !note.isContentAvailable()) {
        return false;
    }

    const { lostBlockIds, movedBlockIds } = performConversion(note, conversion.sourceFormat);
    if (lostBlockIds.length || movedBlockIds.length) {
        getLog().info(`Converting note '${note.noteId}' lost ${lostBlockIds.length} and moved `
            + `${movedBlockIds.length} block references.`);
    }
    return true;
}

/**
 * Saves the pre-conversion revision, transforms the content, and switches the note's type/mime.
 * Returns the block ids that the conversion lost or moved.
 */
function performConversion(note: BNote, sourceFormat: SourceFormat): BlockIdReport {
    const content = note.getContent();
    if (typeof content !== "string") {
        throw new ValidationError(`Note '${note.noteId}' does not have textual content.`);
    }

    // Snapshot the current (pre-conversion) state under a descriptive name.
    const description = sourceFormat === "markdown"
        ? t("note_conversion.revision_before_text")
        : t("note_conversion.revision_before_markdown");

    const {
        content: newContent, type, mime, lostBlockIds, movedBlockIds
    } = convertNoteContent(sourceFormat, content, note.title);

    // Persist the revision, the type/mime switch and the converted content in a single transaction,
    // so a sync peer never observes the note with its new type but old (unconverted) content.
    getSql().transactional(() => {
        note.saveRevision({ description, source: "manual" });

        // Change the type/mime before writing content so type-specific processing (link extraction
        // in `updateNoteData`) runs against the new format.
        note.type = type;
        note.mime = mime;
        note.save();

        noteService.updateNoteData(note.noteId, newContent);
    });
    return { lostBlockIds, movedBlockIds };
}

export default {
    convertNoteContent,
    convertNoteFormat,
    convertNoteByConversionId
};
