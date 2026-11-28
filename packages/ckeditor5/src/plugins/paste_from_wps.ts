import { Plugin } from "ckeditor5";
import type { ViewDocumentClipboardInputEvent } from "ckeditor5";

/** The `mso-spacerun` declaration in a `style` attribute, with its value quoted or not. */
const SPACERUN_DECLARATION = /mso-spacerun\s*:[^;]*;?/gi;

/**
 * Keeps the text of a paste from WPS Office.
 *
 * WPS puts HTML on the clipboard that passes for Microsoft Word, but it marks ordinary text runs
 * with `mso-spacerun`, which Word only puts on runs of spaces. `PasteFromOffice` replaces the
 * content of every such span with non-breaking spaces (ckeditor/ckeditor5#11738), so the pasted
 * text comes out blank. The plugin takes the marker off the spans that hold visible text before
 * `PasteFromOffice` reads the HTML, and leaves the runs of spaces to it.
 */
export default class PasteFromWps extends Plugin {

    static get pluginName() {
        return "PasteFromWps" as const;
    }

    init() {
        // `high`, to rewrite the HTML before `PasteFromOffice` parses it at `low + 10` priority.
        this.listenTo<ViewDocumentClipboardInputEvent>(
            this.editor.editing.view.document,
            "clipboardInput",
            (_evt, data) => {
                if (typeof data.content !== "string") {
                    return;
                }

                const html = withoutSpacerunOnText(data.content);
                if (html !== null) {
                    data.content = html;
                }
            },
            { priority: "high" }
        );
    }

}

/**
 * The HTML with `mso-spacerun` taken off the spans that hold visible text, or `null` if no span
 * does, as in a paste from Word.
 */
export function withoutSpacerunOnText(html: string): string | null {
    if (!html.includes("spacerun")) {
        return null;
    }

    const parsed = new DOMParser().parseFromString(html, "text/html");
    // The same spans that `PasteFromOffice` fills with spaces.
    const textSpans = [ ...parsed.querySelectorAll("span[style*=spacerun]") ]
        .filter((span) => /\S/.test(span.textContent));
    if (!textSpans.length) {
        return null;
    }

    for (const span of textSpans) {
        const style = span.getAttribute("style")!.replace(SPACERUN_DECLARATION, "");
        span.setAttribute("style", style.trim());
    }

    return parsed.documentElement.outerHTML;
}
