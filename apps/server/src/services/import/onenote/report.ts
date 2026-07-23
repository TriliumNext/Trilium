/**
 * Renders the import report placed as the content of the root "OneNote import" note. The task toast
 * is ephemeral — for a multi-hour import the user has likely walked away — so the root note is where
 * the outcome is documented: what was imported, what failed (with links to the affected notes), and
 * the statistics that explain the import's duration.
 */

import { utils } from "@triliumnext/core";
import { t } from "i18next";

/** A page whose content could not be fetched; `noteId` is the placeholder note created in its stead. */
export interface FailedPageReport {
    title: string;
    sectionTitle: string;
    noteId: string;
    error: string;
}

/** A page for which one or more image/attachment downloads failed (the page itself was imported). */
export interface FailedResourceReport {
    pageTitle: string;
    pageNoteId: string;
    failedCount: number;
}

export interface ImportReportData {
    importedPageCount: number;
    notebookCount: number;
    sectionCount: number;
    durationMs: number;
    imageCount: number;
    imageBytes: number;
    attachmentCount: number;
    attachmentBytes: number;
    /** Pages whose handwriting/drawings (InkML) were converted to an embedded SVG. */
    inkPageCount: number;
    /** Cross-page `onenote:` links rewritten to point at an imported note. */
    resolvedLinkCount: number;
    /** Cross-page links whose target page was not part of the imported selection. */
    unresolvedLinkCount: number;
    throttledRequestCount: number;
    throttleWaitMs: number;
    failedPages: FailedPageReport[];
    failedResources: FailedResourceReport[];
}

export function renderImportReport(data: ImportReportData): string {
    const parts: string[] = [];

    parts.push(renderSummaryTable(data));

    if (data.failedPages.length > 0) {
        const rows = data.failedPages.map((page) =>
            `<tr><td>${noteLink(page.noteId, page.title)}</td><td>${utils.escapeHtml(page.sectionTitle)}</td><td>${utils.escapeHtml(page.error)}</td></tr>`);
        parts.push(`<h2>${t("onenote_import.report.failed-pages-title")}</h2>`
            + `<figure class="table"><table><thead><tr><th>${t("onenote_import.report.failed-pages-page")}</th><th>${t("onenote_import.report.failed-pages-section")}</th><th>${t("onenote_import.report.failed-pages-error")}</th></tr></thead>`
            + `<tbody>${rows.join("")}</tbody></table></figure>`);
    }

    if (data.failedResources.length > 0) {
        const items = data.failedResources.map((resource) =>
            `<li>${t("onenote_import.report.failed-resources-item", { pageLink: noteLink(resource.pageNoteId, resource.pageTitle), count: resource.failedCount })}</li>`);
        parts.push(`<h2>${t("onenote_import.report.failed-resources-title")}</h2><ul>${items.join("")}</ul>`);
    }

    return parts.join("");
}

/**
 * The report's lead: a two-column key-value table (heading column, no heading row) with one row per
 * metric. Rows whose metric does not apply to this import (no images, no throttling, …) are omitted
 * so a plain import stays compact.
 */
function renderSummaryTable(data: ImportReportData): string {
    const totalPageCount = data.importedPageCount + data.failedPages.length;
    // Floored so a lossy import never rounds up to a reassuring 100%.
    const successPercent = totalPageCount === 0 ? 100 : Math.floor((data.importedPageCount / totalPageCount) * 100);

    const rows: [string, string | number][] = [
        [t("onenote_import.report.row-pages"), `${data.importedPageCount}/${totalPageCount} (${successPercent}%)`],
        [t("onenote_import.report.row-notebooks"), data.notebookCount],
        [t("onenote_import.report.row-sections"), data.sectionCount],
        [t("onenote_import.report.row-duration"), formatDuration(data.durationMs)]
    ];
    if (data.imageCount > 0) {
        rows.push([t("onenote_import.report.row-images"), `${data.imageCount} (${formatSize(data.imageBytes)})`]);
    }
    if (data.attachmentCount > 0) {
        rows.push([t("onenote_import.report.row-attachments"), `${data.attachmentCount} (${formatSize(data.attachmentBytes)})`]);
    }
    if (data.inkPageCount > 0) {
        rows.push([t("onenote_import.report.row-ink"), data.inkPageCount]);
    }
    if (data.resolvedLinkCount > 0 || data.unresolvedLinkCount > 0) {
        rows.push([t("onenote_import.report.row-links"), t("onenote_import.report.value-links", { resolved: data.resolvedLinkCount, unresolved: data.unresolvedLinkCount })]);
    }
    if (data.throttledRequestCount > 0) {
        rows.push([t("onenote_import.report.row-throttling"), t("onenote_import.report.value-throttling", { count: data.throttledRequestCount, wait: formatDuration(data.throttleWaitMs) })]);
    }

    const body = rows.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join("");
    return `<figure class="table"><table><tbody>${body}</tbody></table></figure>`;
}

/** An internal Trilium link to a note, as CKEditor produces them. */
function noteLink(noteId: string, title: string): string {
    return `<a class="reference-link" href="#root/${noteId}">${utils.escapeHtml(title)}</a>`;
}

/** Formats a duration compactly at a precision matching its magnitude: "42s", "5m 3s", "2h 41m". */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

/** Formats a byte count with a binary unit and at most one decimal: "512 B", "1.5 KiB", "183 MiB". */
export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
    }
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}
