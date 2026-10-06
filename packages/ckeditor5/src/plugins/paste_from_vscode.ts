import { getMimeTypeFromMarkdownName, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { Plugin } from "ckeditor5";
import type { ViewDocumentClipboardInputEvent } from "ckeditor5";

/** The clipboard type VS Code writes next to the copied text, holding the language of the editor. */
export const VSCODE_EDITOR_DATA = "vscode-editor-data";

/**
 * Pastes code copied from VS Code as code: a single line as inline code, several lines as a code
 * block in the language of the VS Code editor.
 *
 * VS Code puts the syntax-highlighted HTML on the clipboard together with
 * {@link VSCODE_EDITOR_DATA}, a JSON object whose `mode` is the language ID. When that object is
 * present, the plugin replaces the HTML with code built from the plain text, so the indentation is
 * exact and the theme colors are dropped. A language that the editor does not offer falls back to
 * the code block's default language.
 *
 * Firefox cannot read {@link VSCODE_EDITOR_DATA}, which VS Code writes in Chromium's own clipboard
 * format. There the plugin recognizes VS Code's HTML instead (see {@link isVsCodeHtml}) and leaves
 * the language to the default.
 *
 * Pasting into an existing code block is left to `CodeBlockEditing`, whose normal-priority
 * listener inserts the plain text.
 */
export default class PasteFromVsCode extends Plugin {

    static get pluginName() {
        return "PasteFromVsCode" as const;
    }

    init() {
        // `high`, to replace the HTML before `ClipboardPipeline` converts it at `low` priority.
        this.listenTo<ViewDocumentClipboardInputEvent>(
            this.editor.editing.view.document,
            "clipboardInput",
            (_evt, data) => {
                const html = vsCodePasteHtml(data.dataTransfer);
                if (html) {
                    data.content = html;
                }
            },
            { priority: "high" }
        );
    }
}

/**
 * The HTML to paste in place of the clipboard's, or `null` if the clipboard holds no code copied
 * from VS Code.
 */
export function vsCodePasteHtml(dataTransfer: { getData(type: string): string }): string | null {
    const mode = readVsCodeMode(dataTransfer.getData(VSCODE_EDITOR_DATA))
        ?? (isVsCodeHtml(dataTransfer.getData("text/html")) ? "" : null);
    if (mode === null) {
        return null;
    }

    const text = dataTransfer.getData("text/plain").replace(/\r\n?/g, "\n").replace(/\n$/, "");
    if (!text.trim()) {
        return null;
    }

    if (!text.includes("\n")) {
        return `<code>${escapeHtml(text.trim())}</code>`;
    }

    const language = codeBlockLanguage(mode);
    const classAttribute = language ? ` class="language-${language}"` : "";
    return `<pre><code${classAttribute}>${escapeHtml(text)}</code></pre>`;
}

/**
 * The code block language (a MIME type normalized by `normalizeMimeTypeForCKEditor()`) for a VS Code
 * language ID, or `null` if Trilium has no MIME type for it.
 */
export function codeBlockLanguage(mode: string): string | null {
    const mime = getMimeTypeFromMarkdownName(mode)?.mime;
    return mime ? normalizeMimeTypeForCKEditor(mime) : null;
}

/**
 * Whether the clipboard HTML has the shape VS Code writes: a single `div` with `white-space: pre`
 * and a monospace font, holding a `div` per line and a `br` per empty line.
 */
export function isVsCodeHtml(html: string): boolean {
    if (!html) {
        return false;
    }

    // A leading `<meta charset>` is parsed into the head, so it does not count as an element here.
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const root = body.firstElementChild;
    if (!(root instanceof HTMLDivElement) || root !== body.lastElementChild) {
        return false;
    }

    if (root.style.whiteSpace !== "pre" || !root.style.fontFamily.includes("monospace")) {
        return false;
    }

    const lines = [...root.childNodes];
    return lines.some((line) => line instanceof HTMLDivElement)
        && lines.every((line) => line instanceof HTMLDivElement || line instanceof HTMLBRElement);
}

/**
 * The `mode` of the {@link VSCODE_EDITOR_DATA} JSON: the language ID, or an empty string if VS Code
 * named none. `null` if the data is absent or malformed.
 */
function readVsCodeMode(editorData: string): string | null {
    if (!editorData) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(editorData);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }

        const mode = (parsed as { mode?: unknown }).mode;
        return typeof mode === "string" ? mode : "";
    } catch {
        return null;
    }
}

function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
