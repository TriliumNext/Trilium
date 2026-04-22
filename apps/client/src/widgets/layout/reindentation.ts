export interface IndentStyle {
    useTabs: boolean;
    width: number;
}

/**
 * Computes the visual column span of a leading-whitespace run. Tabs advance to the next
 * multiple of `tabWidth`; spaces advance by 1.
 */
function measureLeadingColumns(leading: string, tabWidth: number): number {
    let cols = 0;
    for (const ch of leading) {
        if (ch === "\t") {
            cols += tabWidth - (cols % tabWidth);
        } else {
            cols += 1;
        }
    }
    return cols;
}

/**
 * Rewrites the leading whitespace on every line, converting it from the `from` style to the `to`
 * style. Non-leading whitespace is preserved.
 *
 * Handles lines with mixed tabs and spaces in the leading whitespace by measuring the total visual
 * column span (using `from.width` as the tab stop) and then dividing into `to.width`-sized levels.
 * Any leftover columns that don't fit a whole level are emitted as spaces (alignment preserved).
 */
export function convertIndentation(content: string, from: IndentStyle, to: IndentStyle): string {
    if (from.useTabs === to.useTabs && from.width === to.width) return content;
    if (!Number.isFinite(from.width) || !Number.isFinite(to.width) || from.width <= 0 || to.width <= 0) return content;
    const toUnit = to.useTabs ? "\t" : " ".repeat(to.width);

    return content.replace(/^[ \t]+/gm, (leading) => {
        const cols = measureLeadingColumns(leading, from.width);
        const levels = Math.floor(cols / from.width);
        const remainder = cols % from.width;
        return toUnit.repeat(levels) + " ".repeat(remainder);
    });
}
