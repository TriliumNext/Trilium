import html from "html";

import markdownExportService, { type HeaderlessTableMode } from "../export/markdown.js";
import { type EnexTask, extractEnexNoteContent } from "../import/enex_converter.js";
import markdownImportService from "../import/markdown.js";
import { prepareNoteText, type PrepareNoteTextInput, type PreparedNoteText } from "../import/note_text.js";
import { convertOfficeToHtml, type OfficePreviewOptions } from "../office_preview.js";
import { sanitizeHtml } from "../sanitizer.js";
import type { ContentJobEnv } from "./env.js";

/**
 * A CPU-bound content conversion described by plain data, so that it can run in another process.
 * Every field survives `structuredClone`; nothing a job does reads becca, SQL or options, which is
 * what `env` carries instead.
 */
export type ContentJob =
    | { kind: "markdownToHtml"; markdown: string; title: string; obsidian?: boolean; env: ContentJobEnv }
    | { kind: "htmlToMarkdown"; html: string; headerlessTables?: HeaderlessTableMode; env: ContentJobEnv }
    | { kind: "prettyPrintHtml"; html: string }
    | { kind: "sanitizeHtml"; html: string; env: ContentJobEnv }
    | { kind: "enexNoteContent"; content: string; tasks: EnexTask[]; env: ContentJobEnv }
    | { kind: "officeToHtml"; bytes: Uint8Array; mime: string; options: OfficePreviewOptions }
    | { kind: "prepareNoteText"; input: PrepareNoteTextInput; env: ContentJobEnv };

export type ContentJobKind = ContentJob["kind"];

export type ContentJobOf<K extends ContentJobKind> = Extract<ContentJob, { kind: K }>;

export interface ContentJobResults {
    markdownToHtml: string;
    htmlToMarkdown: string;
    prettyPrintHtml: string;
    sanitizeHtml: string;
    enexNoteContent: string;
    officeToHtml: string;
    prepareNoteText: PreparedNoteText;
}

export type ContentJobResult<J extends ContentJob> = ContentJobResults[J["kind"]];

/** Runs a content job in the current thread. A worker process calls this for every job it receives. */
export async function runContentJob<J extends ContentJob>(job: J): Promise<ContentJobResult<J>> {
    const handler = HANDLERS[job.kind] as unknown as (job: J) => ContentJobResult<J> | Promise<ContentJobResult<J>>;
    return handler(job);
}

const HANDLERS: { [K in ContentJobKind]: (job: ContentJobOf<K>) => ContentJobResults[K] | Promise<ContentJobResults[K]> } = {
    markdownToHtml: (job) => markdownImportService.renderToHtml(job.markdown, job.title, {
        obsidian: job.obsidian,
        taskStates: job.env.taskStates,
        allowedTags: job.env.allowedHtmlTags
    }),
    htmlToMarkdown: (job) => markdownExportService.toMarkdown(job.html, {
        headerlessTables: job.headerlessTables,
        taskStates: job.env.taskStates
    }),
    prettyPrintHtml: (job) => html.prettyPrint(job.html, { indent_size: 2 }),
    sanitizeHtml: (job) => sanitizeHtml(job.html, job.env.allowedHtmlTags),
    enexNoteContent: (job) => extractEnexNoteContent(job.content, job.tasks, job.env.allowedHtmlTags),
    officeToHtml: (job) => convertOfficeToHtml(job.bytes, job.mime, job.options),
    prepareNoteText: (job) => prepareNoteText(job.input, job.env)
};
