import { ClipboardPipeline, Plugin, UpcastWriter } from "ckeditor5";
import type { ClipboardInputTransformationEvent, EditingView, ViewDocumentFragment, ViewElement } from "ckeditor5";

/**
 * Properties that Chromium and WebKit write into every computed-style dump and that nobody sets by
 * hand on inline content. `orphans` and `widows` only affect paged media.
 */
const DUMP_FINGERPRINT = [
    "orphans",
    "widows",
    "-webkit-text-stroke-width",
    "font-variant-ligatures",
    "font-variant-caps",
    "text-decoration-thickness"
];

/** How many {@link DUMP_FINGERPRINT} properties an element must carry to count as a dump. */
const FINGERPRINT_THRESHOLD = 3;

/**
 * The styles in a dump that carry meaning rather than the source page's theme, each with the
 * values that are only the default and are therefore dropped too.
 */
const KEPT_STYLES: Record<string, (value: string) => boolean> = {
    "font-weight": (value) => value === "bold" || value === "bolder" || Number(value) >= 600,
    "font-style": (value) => value === "italic" || value.startsWith("oblique"),
    "text-decoration": hasTextDecoration,
    "text-decoration-line": hasTextDecoration,
    "vertical-align": (value) => value === "sub" || value === "super"
};

/**
 * Removes the source page's theme from HTML that a Chromium or WebKit browser copied out of a
 * rendered page.
 *
 * When copying a selection, Chromium, WebKit and every Electron app write the computed styles of the
 * source page inline (`color`, `background-color`, `font-family`, `font-size`, …). Pasted into a
 * note, text copied from a dark-themed page keeps its light-grey text on a near-black background.
 *
 * The plugin recognizes such a paste by {@link DUMP_FINGERPRINT}, then strips every inline style in
 * the fragment except bold, italic, underline, strikethrough, subscript and superscript. Elements,
 * links and classes are kept. Clipboard HTML that applications build themselves (Word, Google Docs,
 * a copy out of another note) carries no fingerprint and is left alone.
 */
export default class ClipboardPageStyles extends Plugin {

    static get requires() {
        return [ClipboardPipeline] as const;
    }

    static get pluginName() {
        return "ClipboardPageStyles" as const;
    }

    init() {
        const view = this.editor.editing.view;

        // `high`, so that the converters behind the normal-priority insertion see the cleaned
        // styles.
        this.listenTo<ClipboardInputTransformationEvent>(
            this.editor.plugins.get(ClipboardPipeline),
            "inputTransformation",
            (_evt, data) => stripPageStyles(view, data.content),
            { priority: "high" }
        );
    }
}

/**
 * Strips the page styles from every element of `fragment` if any of its elements is a computed-style
 * dump. Inner elements of a dump carry only the styles that the page's stylesheet matched (an inline
 * code span's background, for example), so they are cleaned as well, and spans left with no
 * attributes are unwrapped. Returns whether the fragment was a dump.
 */
export function stripPageStyles(view: EditingView, fragment: ViewDocumentFragment): boolean {
    const elements: ViewElement[] = [];
    for (const { item } of view.createRangeIn(fragment)) {
        if (item.is("element")) {
            elements.push(item);
        }
    }

    if (!elements.some(isComputedStyleDump)) {
        return false;
    }

    const writer = new UpcastWriter(view.document);
    for (const element of elements) {
        if (element.hasAttribute("style")) {
            const kept = keptStyles(element);
            writer.removeAttribute("style", element);
            if (Object.keys(kept).length) {
                writer.setStyle(kept, element);
            }
        }

        // A span with no attributes carries nothing, but General HTML Support would keep it.
        if (element.is("element", "span") && !hasAttributes(element)) {
            writer.unwrapElement(element);
        }
    }

    return true;
}

/** Whether the element's inline style is a browser's computed-style dump. */
export function isComputedStyleDump(element: ViewElement): boolean {
    let matches = 0;
    for (const property of DUMP_FINGERPRINT) {
        if (element.hasStyle(property)) {
            matches++;
        }
    }

    return matches >= FINGERPRINT_THRESHOLD;
}

/** The element's styles from {@link KEPT_STYLES} whose values are not the default. */
function keptStyles(element: ViewElement): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const [property, isMeaningful] of Object.entries(KEPT_STYLES)) {
        const value = element.getStyle(property)?.trim().toLowerCase();
        if (value && isMeaningful(value)) {
            kept[property] = value;
        }
    }

    return kept;
}

function hasAttributes(element: ViewElement) {
    return !element.getAttributeKeys().next().done;
}

function hasTextDecoration(value: string) {
    return value.includes("underline") || value.includes("line-through");
}
