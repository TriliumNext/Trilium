import { IndentBlock, Plugin, Table } from "ckeditor5";
import type { DowncastAttributeEvent, DowncastDispatcher, ModelElement } from "ckeditor5";

/**
 * Lets tables participate in block indentation.
 *
 * CKEditor's {@link IndentBlock} feature only allows the `blockIndent` attribute on paragraphs and
 * headings (its `DEFAULT_ELEMENTS`), so tables cannot be indented out of the box. Here we widen the
 * schema to allow `blockIndent` on the `table` element as well. The attribute is downcast generically
 * by `IndentBlock` to a `margin-left` style on the table's `<figure>` wrapper, so the existing
 * `indentBlock`/`outdentBlock` commands and the margin-left round-trip apply to the table once the
 * schema permits it.
 *
 * With a table widget selected, the indent/outdent toolbar buttons then shift the whole table by the
 * configured indentation offset. (Tab inside a table stays reserved for cell navigation, see
 * {@link IndentBlockShortcutPlugin}.)
 *
 * Inserted tables are full width (`TableColumnResize` sets the figure to `width: 100%`), so the raw
 * `margin-left` would push the table past the content edge. We therefore also cap the figure width by
 * the same offset — `max-width: calc(100% - <indent>)` — so an indented table shrinks to stay within
 * its parent instead of overflowing. Narrower (resized) tables are below that cap and are unaffected.
 */
export default class TableIndent extends Plugin {

    static get requires() {
        return [IndentBlock, Table] as const;
    }

    static get pluginName() {
        return "TableIndent" as const;
    }

    init() {
        const editor = this.editor;
        editor.model.schema.extend("table", { allowAttributes: "blockIndent" });
        editor.conversion.for("downcast").add(keepIndentedTableWithinParent);
    }

}

/**
 * Downcast helper: mirrors `IndentBlock`'s `margin-left` on an indented table with a matching
 * `max-width: calc(100% - <indent>)` so the table stays within its parent. Runs at low priority so
 * the table's `<figure>` is already mapped, and does not consume the attribute — `IndentBlock` keeps
 * ownership of `margin-left`.
 */
function keepIndentedTableWithinParent(dispatcher: DowncastDispatcher) {
    dispatcher.on<DowncastAttributeEvent>("attribute:blockIndent:table", (evt, data, conversionApi) => {
        // The event name is scoped to `table`, so `data.item` is always the table element.
        const figure = conversionApi.mapper.toViewElement(data.item as ModelElement);
        /* v8 ignore next 3 -- defensive: at low priority the table is already converted, so it always maps to a view element */
        if (!figure) {
            return;
        }

        const viewWriter = conversionApi.writer;
        if (data.attributeNewValue) {
            viewWriter.setStyle("max-width", `calc(100% - ${data.attributeNewValue})`, figure);
        } else {
            viewWriter.removeStyle("max-width", figure);
        }
    }, { priority: "low" });
}
