import "../../theme/format_painter.css";

import { IconPaintRoller } from "@ckeditor/ckeditor5-icons";
import {
    ButtonView, DomEmitterMixin, keyCodes, type Model, type ModelPosition, Plugin, type ViewDocumentKeyDownEvent
} from "ckeditor5";

import { COPY_FORMAT_COMMAND, CURSOR_ACTIVE_CSS_CLASS, FORMAT_PAINTER_COMPONENT, PASTE_FORMAT_COMMAND } from "./constants.js";

const FormatPainterUIBase = DomEmitterMixin(Plugin);

/**
 * The `formatPainter` toolbar button and its one-shot painting behaviour.
 *
 * Clicking the button copies the current selection's formatting and *arms* the painter: the editing
 * roots take a cursor class and the next click (or drag-release) inside the editor pastes that
 * formatting onto whatever the click selected, or onto the whole word under a caret, then disarms.
 * Clicking the button again applies the formatting to text selected since it armed, which is how a
 * selection made without a mouse, such as with the handles of a touch screen, is painted; otherwise
 * it cancels, as do pressing Escape and the editor going read-only.
 *
 * There is deliberately no keyboard shortcut: the Word/Office pair `Ctrl+Shift+C`/`Ctrl+Shift+V`
 * collides in the browser with "inspect element" (reserved, not preventable) and "paste as plain
 * text". The `copyFormat`/`pasteFormat` commands remain available for a non-conflicting binding.
 */
export default class FormatPainterUI extends FormatPainterUIBase {

    declare public isActive: boolean;

    /** Whether the button applies the formatting, to text selected since the painter armed. */
    declare public canApply: boolean;

    static get pluginName() {
        return "FormatPainterUI" as const;
    }

    init() {
        const editor = this.editor;

        this.set("isActive", false);
        this.set("canApply", false);

        editor.ui.componentFactory.add(FORMAT_PAINTER_COMPONENT, (locale) => {
            const button = new ButtonView(locale);
            const copyCommand = editor.commands.get(COPY_FORMAT_COMMAND);

            button.set({ icon: IconPaintRoller, tooltip: true });
            button.bind("label").to(this, "canApply", (canApply) =>
                (canApply ? editor.t("Apply formatting") : editor.t("Copy formatting")));

            /* v8 ignore next 3 -- copyFormat is registered by the required editing plugin before the toolbar builds this button; the guard only narrows the type */
            if (!copyCommand) {
                return button;
            }

            // `isEnabled` follows "can I copy here"; `isOn` shows the button pressed while armed.
            button.bind("isEnabled").to(copyCommand);
            button.bind("isOn").to(this, "isActive");
            this.listenTo(button, "execute", () => this._toggle());

            return button;
        });

        // A click landing after the editor turned read-only would paste into no-longer-editable
        // content, so drop an armed painter when that happens.
        this.listenTo(editor, "change:isReadOnly", () => this._disarm());

        this.listenTo<ViewDocumentKeyDownEvent>(editor.editing.view.document, "keydown", (evt, data) => {
            if (this.isActive && data.keyCode === keyCodes.esc) {
                this._disarm();
                data.preventDefault();
                evt.stop();
            }
        }, { priority: "high" });
    }

    override destroy() {
        super.destroy();
        this._disarm();
    }

    private _toggle() {
        if (this.canApply) {
            this._paint();
            return;
        }
        if (this.isActive) {
            this._disarm();
            return;
        }

        this._arm();
    }

    private _arm() {
        const editor = this.editor;

        editor.execute(COPY_FORMAT_COMMAND);
        this.isActive = true;
        this.listenTo(editor.model.document.selection, "change:range", this._followSelection);

        for (const root of editor.editing.view.domRoots.values()) {
            root.classList.add(CURSOR_ACTIVE_CSS_CLASS);
            this.listenTo(root, "mouseup", this._paint);
        }
    }

    private readonly _followSelection = () => {
        this.canApply = !this.editor.model.document.selection.isCollapsed;
    };

    private readonly _paint = () => {
        const { model } = this.editor;
        const selection = model.document.selection;
        const caret = selection.isCollapsed ? selection.getFirstPosition() : null;
        const word = caret && getWordRange(model, caret);

        if (caret && word) {
            // Painted through a selection of the word, given back in the same step to undo.
            model.change((writer) => {
                writer.setSelection(word);
                this.editor.execute(PASTE_FORMAT_COMMAND);
                writer.setSelection(caret);
            });
        } else {
            this.editor.execute(PASTE_FORMAT_COMMAND);
        }
        this.editor.editing.view.focus();
        this._disarm();
    };

    private _disarm() {
        if (!this.isActive) {
            return;
        }

        this.isActive = false;
        this.canApply = false;
        this.stopListening(this.editor.model.document.selection, "change:range", this._followSelection);

        for (const root of this.editor.editing.view.domRoots.values()) {
            root.classList.remove(CURSOR_ACTIVE_CSS_CLASS);
            this.stopListening(root, "mouseup", this._paint);
        }
    }
}

/** The word around `position`, as letters, digits and underscores on either side, or `null` outside one. */
function getWordRange(model: Model, position: ModelPosition) {
    const block = model.createRangeIn(position.parent);
    const reach = (direction: "forward" | "backward") => {
        let end = position;
        for (const { item, nextPosition } of block.getWalker({ startPosition: position, direction, singleCharacters: true })) {
            if (!item.is("$textProxy") || !/^[\p{L}\p{N}_]$/u.test(item.data)) {
                break;
            }
            end = nextPosition;
        }
        return end;
    };

    const range = model.createRange(reach("backward"), reach("forward"));
    return range.isCollapsed ? null : range;
}
