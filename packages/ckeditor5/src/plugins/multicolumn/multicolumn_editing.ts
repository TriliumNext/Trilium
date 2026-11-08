import {
    enableViewPlaceholder,
    type LocaleTranslate,
    type ModelElement,
    type ModelNode,
    type ModelPosition,
    type ModelWriter,
    type PlaceholderableViewElement,
    Plugin,
    toWidget,
    toWidgetEditable,
    type ViewEditableElement,
    Widget
} from "ckeditor5";

import NestedLimitSelection from "../nested_limit_selection.js";
import { markFocusedContainers } from "../widget_utils.js";
import {
    COLUMN_CLASS, COLUMN_RATIOS, ELEMENTS, FOCUSED_LAYOUT_CLASS, getColumnCount, getDefaultRatios,
    LAYOUT_CLASS, LAYOUT_WIDGET_PROPERTY, MAX_COLUMNS, MIN_COLUMNS, RATIOS_ATTRIBUTE,
    RATIOS_DATA_ATTRIBUTE
} from "./constants.js";
import {
    ColumnLayoutCommand, InsertLayoutColumnCommand, InsertMulticolumnLayoutCommand,
    MoveLayoutColumnCommand, MoveToLayoutColumnCommand, RemoveMulticolumnLayoutCommand,
    setColumnCount
} from "./multicolumn_commands.js";

/**
 * Schema, conversion and commands for multicolumn layouts: blocks of two to four columns of block
 * content.
 */
export default class MulticolumnEditing extends Plugin {

    public static get pluginName() {
        return "MulticolumnEditing" as const;
    }

    public static get requires() {
        return [Widget, NestedLimitSelection] as const;
    }

    public init(): void {
        const editor = this.editor;
        editor.commands.add("multicolumnLayout", new InsertMulticolumnLayoutCommand(editor));
        editor.commands.add("columnLayout", new ColumnLayoutCommand(editor));
        editor.commands.add("removeMulticolumnLayout", new RemoveMulticolumnLayoutCommand(editor));
        editor.commands.add("insertLayoutColumn", new InsertLayoutColumnCommand(editor));
        editor.commands.add("moveLayoutColumn", new MoveLayoutColumnCommand(editor));
        editor.commands.add("moveToLayoutColumn", new MoveToLayoutColumnCommand(editor));

        this.registerSchema();
        this.registerConversion();
        this.registerPostFixer();
        markFocusedContainers(editor, FOCUSED_LAYOUT_CLASS,
            element => element.hasClass(LAYOUT_CLASS));
    }

    private registerSchema() {
        const schema = this.editor.model.schema;
        schema.register(ELEMENTS.layout, {
            inheritAllFrom: "$blockObject",
            allowAttributes: RATIOS_ATTRIBUTE
        });
        schema.register(ELEMENTS.column, {
            allowIn: ELEMENTS.layout,
            allowContentOf: "$root",
            isLimit: true
        });
    }

    private registerConversion() {
        const editor = this.editor;
        const conversion = editor.conversion;
        const t = editor.t;

        // High priority runs the upcasts before General HTML Support, which also matches `<div>`s.
        conversion.for("upcast").elementToElement({
            view: { name: "div", classes: LAYOUT_CLASS },
            model: ELEMENTS.layout,
            converterPriority: "high"
        });
        conversion.for("upcast").elementToElement({
            view: { name: "div", classes: COLUMN_CLASS },
            model: ELEMENTS.column,
            converterPriority: "high"
        });
        conversion.attributeToAttribute({
            model: { name: ELEMENTS.layout, key: RATIOS_ATTRIBUTE },
            view: RATIOS_DATA_ATTRIBUTE
        });

        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.layout,
            view: (_model, { writer }) =>
                writer.createContainerElement("div", { class: LAYOUT_CLASS })
        });
        conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.column,
            view: (_model, { writer }) =>
                writer.createContainerElement("div", { class: COLUMN_CLASS })
        });

        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.layout,
            view: (_model, { writer }) => {
                const layout = writer.createContainerElement("div", { class: LAYOUT_CLASS });
                writer.setCustomProperty(LAYOUT_WIDGET_PROPERTY, true, layout);
                return toWidget(layout, writer, {
                    label: t("Multicolumn layout"),
                    hasSelectionHandle: true
                });
            }
        });
        conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.column,
            view: (model, { writer }) => {
                const column: ViewEditableElement & PlaceholderableViewElement =
                    writer.createEditableElement("div", { class: COLUMN_CLASS });
                column.placeholder = getColumnPlaceholder(t, model.index);
                enableViewPlaceholder({
                    view: editor.editing.view,
                    element: column,
                    isDirectHost: false,
                    keepOnFocus: true
                });
                return toWidgetEditable(column, writer, { label: t("Column") });
            }
        });
    }

    /**
     * Keeps every layout valid however it was produced (paste, import, undo): it has two to four
     * columns, no column is empty, and its weights match its column count.
     */
    private registerPostFixer() {
        const model = this.editor.model;

        model.document.registerPostFixer(writer => {
            const layouts = new Set<ModelElement>();
            for (const change of model.document.differ.getChanges()) {
                if (change.type === "attribute") {
                    const node = change.range.start.nodeAfter;
                    if (node?.is("element", ELEMENTS.layout)) {
                        layouts.add(node);
                    }
                    continue;
                }
                collectLayoutsAround(change.position, layouts);
                if (change.type === "insert") {
                    collectLayoutsWithin(change.position.nodeAfter, layouts);
                }
            }

            let changed = false;
            for (const layout of layouts) {
                changed = fixLayout(writer, layout) || changed;
            }
            return changed;
        });
    }
}

/**
 * The placeholder of the column at `index`, which names its position. A layout has at most
 * `MAX_COLUMNS` (four) columns. A column in a layout always has an index.
 */
function getColumnPlaceholder(t: LocaleTranslate, index: number | null) {
    switch (index) {
        case 0: return t("Type the content of the first column");
        case 1: return t("Type the content of the second column");
        case 2: return t("Type the content of the third column");
        default: return t("Type the content of the fourth column");
    }
}

function collectLayoutsAround(position: ModelPosition, layouts: Set<ModelElement>) {
    for (const ancestor of position.getAncestors()) {
        if (ancestor.is("element", ELEMENTS.layout)) {
            layouts.add(ancestor);
        }
    }
}

function collectLayoutsWithin(node: ModelNode | null, layouts: Set<ModelElement>) {
    if (!node?.is("element")) {
        return;
    }
    if (node.is("element", ELEMENTS.layout)) {
        layouts.add(node);
    }
    for (const child of node.getChildren()) {
        collectLayoutsWithin(child, layouts);
    }
}

function fixLayout(writer: ModelWriter, layout: ModelElement): boolean {
    /* v8 ignore next 3 -- the differ reports no change inside a removed element */
    if (layout.root.rootName === "$graveyard") {
        return false;
    }

    if (layout.isEmpty) {
        writer.remove(layout);
        return true;
    }

    let changed = false;
    const count = Math.min(Math.max(layout.childCount, MIN_COLUMNS), MAX_COLUMNS);
    if (count !== layout.childCount) {
        setColumnCount(writer, layout, count);
        changed = true;
    }

    for (const column of layout.getChildren()) {
        if ((column as ModelElement).isEmpty) {
            writer.appendElement("paragraph", column as ModelElement);
            changed = true;
        }
    }

    if (!isValidRatios(layout.getAttribute(RATIOS_ATTRIBUTE), count)) {
        writer.setAttribute(RATIOS_ATTRIBUTE, getDefaultRatios(count), layout);
        changed = true;
    }
    return changed;
}

function isValidRatios(ratios: unknown, count: number) {
    return typeof ratios === "string"
        && COLUMN_RATIOS.includes(ratios)
        && getColumnCount(ratios) === count;
}
