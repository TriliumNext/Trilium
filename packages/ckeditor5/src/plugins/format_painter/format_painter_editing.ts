import { Command, type Editor, Plugin } from "ckeditor5";

import { COPY_FORMAT_COMMAND, PASTE_FORMAT_COMMAND } from "./constants.js";

/** An attribute-name → value map of the model's *formatting* attributes (bold, fontColor, …). */
export type FormattingAttributes = Record<string, unknown>;

/**
 * Registers the two commands the format painter is built on:
 *
 * - `copyFormat` reads the formatting attributes of the current selection and stores them,
 * - `pasteFormat` clears the target selection's formatting and applies the stored set.
 *
 * "Formatting attribute" is not guessed: an attribute counts when the schema marks it
 * `isFormatting` — the same public signal `RemoveFormat` uses — so this automatically tracks every
 * inline mark the editor registers, including Trilium's own (`kbd`, reference links).
 *
 * This mirrors the split premium `FormatPainter` uses (`FormatPainterEditing` + `CopyFormatCommand`
 * + `PasteFormatCommand`), reimplemented on public API so the premium plugin — the last one still
 * forcing the commercial licence — can be dropped.
 */
export default class FormatPainterEditing extends Plugin {

    static get pluginName() {
        return "FormatPainterEditing" as const;
    }

    init() {
        const editor = this.editor;
        const copyCommand = new CopyFormatCommand(editor);

        editor.commands.add(COPY_FORMAT_COMMAND, copyCommand);
        // Paste reads from the copy command directly, rather than looking it up by name, so it has no
        // "command missing" path to guard — the two are always created together, here.
        editor.commands.add(PASTE_FORMAT_COMMAND, new PasteFormatCommand(editor, copyCommand));
    }
}

/**
 * Copies the formatting of the current selection into {@link #value}, from where `pasteFormat` (or a
 * direct `pasteFormat` argument) reads it. `reset()` forgets it again.
 */
export class CopyFormatCommand extends Command {

    override value: FormattingAttributes | undefined = undefined;

    override refresh() {
        this.isEnabled = selectionAllowsText(this.editor);
    }

    override execute() {
        this.value = readFormatting(this.editor);
    }

    reset() {
        this.value = undefined;
    }
}

/**
 * Applies formatting to the current selection: the argument if given, otherwise whatever
 * `copyFormat` last stored. Existing formatting on the target is cleared first, so the paste
 * *replaces* rather than *merges* — matching the premium behaviour and what "copy this format onto
 * that" implies.
 */
export class PasteFormatCommand extends Command {

    constructor(editor: Editor, private readonly _source: CopyFormatCommand) {
        super(editor);
    }

    override refresh() {
        this.isEnabled = selectionAllowsText(this.editor);
    }

    override execute(formatting?: FormattingAttributes) {
        const toApply = formatting ?? this._source.value;

        if (!toApply) {
            return;
        }

        applyFormatting(this.editor, toApply);
    }
}

/** Whether text — and therefore inline formatting — is allowed where the selection sits. */
function selectionAllowsText(editor: Editor): boolean {
    const position = editor.model.document.selection.getFirstPosition();

    /* v8 ignore next 3 -- a live document selection always has a first position; the guard only narrows the type */
    if (!position) {
        return false;
    }

    return editor.model.schema.checkChild(position, "$text");
}

/**
 * The formatting attributes of the current selection. For a collapsed caret these are the selection
 * attributes (the formatting the next character would take); for a range they are read from its
 * first text node, matching how the source formatting is "the format at the start of the selection".
 */
function readFormatting(editor: Editor): FormattingAttributes {
    const schema = editor.model.schema;
    const result: FormattingAttributes = {};

    for (const [ name, value ] of formattingSource(editor)) {
        if (schema.getAttributeProperties(name).isFormatting) {
            result[name] = value;
        }
    }

    return result;
}

function formattingSource(editor: Editor): Iterable<[string, unknown]> {
    const selection = editor.model.document.selection;

    if (selection.isCollapsed) {
        return selection.getAttributes();
    }

    for (const range of selection.getRanges()) {
        for (const item of range.getItems()) {
            if (item.is("$textProxy")) {
                return item.getAttributes();
            }
        }
    }

    // A ranged selection over objects only (e.g. an image) carries no text to read formatting from.
    return selection.getAttributes();
}

function applyFormatting(editor: Editor, formatting: FormattingAttributes): void {
    const model = editor.model;
    const schema = model.schema;
    const selection = model.document.selection;

    model.change((writer) => {
        if (selection.isCollapsed) {
            for (const name of [ ...selection.getAttributeKeys() ]) {
                if (schema.getAttributeProperties(name).isFormatting) {
                    writer.removeSelectionAttribute(name);
                }
            }

            for (const [ name, value ] of Object.entries(formatting)) {
                writer.setSelectionAttribute(name, value);
            }

            return;
        }

        for (const range of [ ...selection.getRanges() ]) {
            // Clearing first is what makes the paste replace the target's formatting rather than
            // layer onto it. Attribute edits never shift offsets, so `range` stays valid afterwards.
            for (const item of [ ...range.getItems() ]) {
                if (!item.is("$textProxy")) {
                    continue;
                }

                const itemRange = writer.createRangeOn(item);

                for (const name of [ ...item.getAttributeKeys() ]) {
                    if (schema.getAttributeProperties(name).isFormatting) {
                        writer.removeAttribute(name, itemRange);
                    }
                }
            }

            for (const [ name, value ] of Object.entries(formatting)) {
                for (const validRange of schema.getValidRanges([ range ], name)) {
                    writer.setAttribute(name, value, validRange);
                }
            }
        }
    });
}
