import { Plugin } from "ckeditor5";

import FormatPainterEditing from "./format_painter_editing.js";
import FormatPainterUI from "./format_painter_ui.js";

/**
 * The format painter — "copy this text's formatting onto that text".
 *
 * A GPL reimplementation of premium `FormatPainter`, built entirely on public CKEditor API (the
 * `isFormatting` schema flag, `Command`, `ButtonView`) so the commercial plugin — the last one still
 * pulling in the premium licence — can be dropped. Split, as premium was, into an editing half
 * ({@link FormatPainterEditing}: the `copyFormat`/`pasteFormat` commands) and a UI half
 * ({@link FormatPainterUI}: the `formatPainter` button and its one-shot painting).
 */
export default class TriliumFormatPainter extends Plugin {

    static get requires() {
        return [ FormatPainterEditing, FormatPainterUI ];
    }

    static get pluginName() {
        return "TriliumFormatPainter" as const;
    }
}
