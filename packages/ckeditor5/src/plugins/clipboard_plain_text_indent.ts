import { ClipboardPipeline, Plugin, plainTextToHtml, UpcastWriter, viewToPlainText } from "ckeditor5";
import type { Editor, EditingView, ViewDocumentClipboardInputEvent, ViewDocumentClipboardOutputEvent, ViewDocumentFragment, ViewElement, ViewNode } from "ckeditor5";

/**
 * The custom property of a view element that holds the element's text in the `text/plain`
 * clipboard flavor. `viewToIndentedPlainText()` writes that text instead of the element.
 */
export const CLIPBOARD_PLAIN_TEXT_PROPERTY = "clipboard:plainText";

/** The blocks that `IndentBlock` indents with a margin. */
const INDENTABLE_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Writes `IndentBlock` indents to the `text/plain` clipboard flavor as one tab per level, and reads
 * them back from a paste that carries only plain text.
 */
export default class ClipboardPlainTextIndent extends Plugin {

    static get requires() {
        return [ClipboardPipeline] as const;
    }

    static get pluginName() {
        return "ClipboardPlainTextIndent" as const;
    }

    init() {
        // `lowest`, so that the text replaces the one `ClipboardPipeline` sets at `low`.
        this.listenTo<ViewDocumentClipboardOutputEvent>(
            this.editor.editing.view.document,
            "clipboardOutput",
            (_evt, data) => {
                if (!data.content.isEmpty) {
                    data.dataTransfer.setData("text/plain", viewToIndentedPlainText(this.editor, data.content));
                }
            },
            { priority: "lowest" }
        );

        // `high`, to replace the HTML before `ClipboardPipeline` converts it at `low` priority.
        this.listenTo<ViewDocumentClipboardInputEvent>(
            this.editor.editing.view.document,
            "clipboardInput",
            (_evt, data) => {
                if (data.dataTransfer.getData("text/html")) {
                    return;
                }

                const html = indentedPlainTextToHtml(this.editor, data.dataTransfer.getData("text/plain"));
                if (html) {
                    data.content = html;
                }
            },
            { priority: "high" }
        );
    }
}

/**
 * Converts plain text to HTML, indenting each paragraph by the tabs that lead all of its lines.
 * Returns `null` when no line starts with a tab or `IndentBlock` cannot read back a margin.
 */
export function indentedPlainTextToHtml(editor: Editor, text: string): string | null {
    if (!/^\t/m.test(text) || !editor.plugins.has("IndentBlock") || editor.config.get("indentBlock")?.classes?.length) {
        return null;
    }

    const offset = indentOffset(editor);
    const side = editor.locale.contentLanguageDirection === "rtl" ? "right" : "left";

    return text.split(/\r?\n\r?\n/).map((paragraph) => {
        const lines = paragraph.split(/\r?\n/);
        const level = sharedTabs(lines);
        const strip = new RegExp(`^\\t{0,${level}}`);
        // Converted line by line, so that a blank line stays a `<br>` inside the paragraph.
        const body = lines.map((line) => plainTextToHtml(line.replace(strip, ""))).join("<br>");
        const style = level ? ` style="margin-${side}:${level * offset.value}${offset.unit}"` : "";

        return `<p${style}>${body}</p>`;
    }).join("");
}

/**
 * Serializes `fragment` as `viewToPlainText()` does, prefixing each line of an indented block with
 * one tab per level, and writing an element that carries {@link CLIPBOARD_PLAIN_TEXT_PROPERTY} as
 * that text. The fragment is unchanged afterwards.
 */
export function viewToIndentedPlainText(editor: Editor, fragment: ViewDocumentFragment): string {
    const view = editor.editing.view;
    const writer = new UpcastWriter(view.document);
    const offset = indentOffset(editor);
    const restores = replaceWithPlainText(view, writer, fragment);

    const insertions: { parent: ViewElement; index: number; tabs: string }[] = [];
    for (const { item } of view.createRangeIn(fragment)) {
        if (!item.is("element") || !INDENTABLE_BLOCKS.has(item.name)) {
            continue;
        }

        const level = indentLevel(item, offset);
        if (!level) {
            continue;
        }

        const tabs = "\t".repeat(level);
        insertions.push({ parent: item, index: 0, tabs });
        for (const { item: inner } of view.createRangeIn(item)) {
            if (inner.is("element", "br") && inner.parent?.is("element") && inner.index !== null
                && !isLastInBlock(view, inner, item)) {
                insertions.push({ parent: inner.parent, index: inner.index + 1, tabs });
            }
        }
    }

    // Inserting from the last position backwards keeps the earlier indexes valid.
    const inserted: ViewNode[] = [];
    for (const { parent, index, tabs } of insertions.reverse()) {
        const text = writer.createText(tabs);
        writer.insertChild(index, text, parent);
        inserted.push(text);
    }

    try {
        return viewToPlainText(editor.data.htmlProcessor.domConverter, fragment);
    } finally {
        for (const text of inserted) {
            writer.remove(text);
        }
        for (const restore of restores.reverse()) {
            restore();
        }
    }
}

/**
 * Writes the text of each element in `fragment` that carries {@link CLIPBOARD_PLAIN_TEXT_PROPERTY}
 * in place of its content, and returns the functions that undo it. A block element keeps its
 * element, so that `viewToPlainText()` still separates it from its siblings. An inline element
 * becomes a `span`, which `viewToPlainText()` separates from nothing.
 */
function replaceWithPlainText(
    view: EditingView, writer: UpcastWriter, fragment: ViewDocumentFragment
) {
    const restores: (() => void)[] = [];
    for (const item of Array.from(view.createRangeIn(fragment).getItems())) {
        if (!item.is("element")) {
            continue;
        }

        const plainText = item.getCustomProperty(CLIPBOARD_PLAIN_TEXT_PROPERTY);
        if (typeof plainText !== "string") {
            continue;
        }

        const text = writer.createText(plainText);
        if (view.domConverter.blockElements.includes(item.name)) {
            const children = writer.removeChildren(0, item.childCount, item);
            writer.appendChild(text, item);
            restores.push(() => {
                writer.remove(text);
                writer.appendChild(children, item);
            });
        } else {
            const replacement = writer.createElement("span", null, text);
            writer.replace(item, replacement);
            restores.push(() => writer.replace(replacement, item));
        }
    }

    return restores;
}

/** The width of one indent level, from the `indentBlock` config `IndentBlock` defaults to `40px`. */
function indentOffset(editor: Editor) {
    const config = editor.config.get("indentBlock");
    return { value: config?.offset ?? 40, unit: config?.unit ?? "px" };
}

/** The indent levels of `block`. A margin in a unit other than the configured one counts as one. */
function indentLevel(block: ViewElement, offset: { value: number; unit: string }) {
    const margin = block.getStyle("margin-left") ?? block.getStyle("margin-right");
    const match = margin?.trim().match(/^(\d*\.?\d+)([a-z%]*)$/i);
    if (!match) {
        return 0;
    }

    const value = Number(match[1]);
    if (value <= 0) {
        return 0;
    }

    return match[2] === offset.unit ? Math.max(1, Math.round(value / offset.value)) : 1;
}

/** The number of tabs that lead every non-blank line, or 0 when all lines are blank. */
function sharedTabs(lines: string[]) {
    let shared = Infinity;
    for (const line of lines) {
        if (line.trim()) {
            shared = Math.min(shared, line.length - line.replace(/^\t+/, "").length);
        }
    }

    return Number.isFinite(shared) ? shared : 0;
}

/** Whether nothing follows `node` inside `block`, so a line break there starts no new line of text. */
function isLastInBlock(view: EditingView, node: ViewNode, block: ViewElement) {
    const rest = view.createRange(view.createPositionAfter(node), view.createPositionAt(block, "end"));
    return rest.getItems().next().done === true;
}
