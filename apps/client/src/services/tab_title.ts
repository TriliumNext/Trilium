/**
 * Pure helpers for assembling a tab's title from its splits. Kept free of DOM/appContext so the
 * formatting rules (separator, empty-split fallback, per-segment active flag) can be unit-tested.
 */

export const TAB_TITLE_SEPARATOR = " • ";

export interface TabTitleSegment {
    text: string;
    /** The segment's markup: the split's own `html`, else its escaped `text`. */
    html: string;
    active: boolean;
}

/** Escapes HTML special characters so note titles can be safely embedded in the tooltip markup. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Builds the per-split segments and the tooltip strings for a tab title. Each split contributes one
 * segment; an empty/untitled split falls back to `emptyLabel` so the title stays 1:1 with the panes.
 *
 * `tooltip` is plain text; `tooltipHtml` escapes every title (untrusted) and wraps the active split in
 * trusted `<strong>` so it stands out — only the surrounding markup is trusted, never the titles.
 * A split's `html` is trusted markup that replaces its escaped title in the segment and tooltip.
 *
 * `options.pinnedPrefix`, when set, is prepended to the tooltip (e.g. "Pinned: ").
 */
export function buildTabTitle(
    splits: { title: string | null | undefined; html?: string; active: boolean }[],
    emptyLabel: string,
    options: { pinnedPrefix?: string } = {}
): { segments: TabTitleSegment[]; tooltip: string; tooltipHtml: string } {
    const segments = splits.map((split) => {
        const text = split.title || emptyLabel;
        return { text, html: split.html ?? escapeHtml(text), active: split.active };
    });

    const prefix = options.pinnedPrefix ?? "";
    // only emphasize the active split when there's more than one — bolding a lone title is pointless
    const emphasizeActive = segments.length > 1;
    const body = segments.map((segment) => segment.text).join(TAB_TITLE_SEPARATOR);
    const bodyHtml = segments
        .map((segment) => (segment.active && emphasizeActive
            ? `<strong>${segment.html}</strong>`
            : segment.html))
        .join(TAB_TITLE_SEPARATOR);

    return {
        segments,
        tooltip: `${prefix}${body}`,
        tooltipHtml: `${escapeHtml(prefix)}${bodyHtml}`
    };
}
