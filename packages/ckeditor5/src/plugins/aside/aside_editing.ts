import {
    type DowncastInsertEvent,
    enableViewPlaceholder,
    type MapperModelToViewPositionEvent,
    type ModelElement,
    type ModelNode,
    type ModelPosition,
    type ModelWriter,
    type PlaceholderableViewElement,
    Plugin,
    toWidget,
    toWidgetEditable,
    type UpcastElementEvent,
    type ViewEditableElement,
    type ViewElement,
    Widget
} from "ckeditor5";

import NestedLimitSelection from "../nested_limit_selection.js";
import PositionedWidgets, {
    getPositionAttributes, getPositionOfView
} from "../positioned_widgets.js";
import ResizableWidgets from "../resizable_widgets/resizable_widgets.js";
import { markFocusedContainers } from "../widget_utils.js";
import { InsertAsideCommand, RemoveAsideCommand } from "./aside_commands.js";
import {
    ASIDE_WIDGET_PROPERTY, COMMANDS, CONTENT_CLASS, ELEMENTS, FOCUSED_ASIDE_CLASS, MIN_WIDTH,
    WIDTH_PROPERTY_PREFIX
} from "./constants.js";

/**
 * Schema, conversion and commands of asides. An aside is saved as an `<aside>` that holds its
 * blocks, while the model keeps them in an `asideContent` element, which the editing view draws as
 * a nested editable.
 */
export default class AsideEditing extends Plugin {

    static get pluginName() {
        return "AsideEditing" as const;
    }

    static get requires() {
        return [ Widget, NestedLimitSelection, ResizableWidgets, PositionedWidgets ] as const;
    }

    init() {
        const editor = this.editor;
        editor.commands.add(COMMANDS.insert, new InsertAsideCommand(editor));
        editor.commands.add(COMMANDS.remove, new RemoveAsideCommand(editor));

        this.registerSchema();
        this.registerUpcast();
        this.registerDataDowncast();
        this.registerEditingDowncast();
        this.registerPostFixer();

        const positionedWidgets = editor.plugins.get(PositionedWidgets);
        positionedWidgets.register(ELEMENTS.aside, { commandName: COMMANDS.position });
        // A widget with a fixed height shows the corner grip alone, which resizes the width.
        editor.plugins.get(ResizableWidgets).register(ELEMENTS.aside, {
            propertyPrefix: WIDTH_PROPERTY_PREFIX,
            isWidthResizable: true,
            isHeightResizable: () => false,
            getAnchor: (aside) => positionedWidgets.getAnchor(aside),
            minWidth: MIN_WIDTH
        });
        markFocusedContainers(editor, FOCUSED_ASIDE_CLASS, isAsideWidget);
    }

    private registerSchema() {
        const schema = this.editor.model.schema;
        schema.register(ELEMENTS.aside, { inheritAllFrom: "$blockObject" });
        schema.register(ELEMENTS.content, {
            allowIn: ELEMENTS.aside,
            allowContentOf: "$root",
            isLimit: true
        });
    }

    /**
     * Converts an `<aside>` that is not an admonition, before the admonition and General HTML
     * Support do. Its blocks go into the content of the aside.
     */
    private registerUpcast() {
        this.editor.data.upcastDispatcher.on<UpcastElementEvent>("element:aside",
            (_evt, data, api) => {
                const view = data.viewItem;
                if (view.hasClass("admonition") || !api.consumable.test(view, { name: true })) {
                    return;
                }

                const { writer } = api;
                const aside = writer.createElement(ELEMENTS.aside, getPositionOfView(view));
                const content = writer.createElement(ELEMENTS.content);
                writer.append(content, aside);
                if (!api.safeInsert(aside, data.modelCursor)) {
                    return;
                }

                api.consumable.consume(view, { name: true });
                api.convertChildren(view, content);
                api.updateConversionResult(aside, data);
            }, { priority: "high" });
    }

    /** Saves an aside as an `<aside>` that holds the blocks of its content. */
    private registerDataDowncast() {
        const data = this.editor.data;
        this.editor.conversion.for("dataDowncast").elementToElement({
            model: ELEMENTS.aside,
            view: (aside, { writer }) =>
                writer.createContainerElement("aside", getPositionAttributes(aside))
        });

        data.downcastDispatcher.on<DowncastInsertEvent<ModelElement>>(`insert:${ELEMENTS.content}`,
            (_evt, { item }, api) => {
                api.consumable.consume(item, "insert");
                api.convertChildren(item);
            });

        // The blocks of the content go into the `<aside>` of its parent.
        data.mapper.on<MapperModelToViewPositionEvent>("modelToViewPosition", (_evt, mapping) => {
            const content = mapping.modelPosition.parent;
            const aside = content.is("element", ELEMENTS.content)
                ? mapping.mapper.toViewElement(content.parent as ModelElement)
                : undefined;
            if (aside) {
                mapping.viewPosition = mapping.mapper.findPositionIn(aside,
                    mapping.modelPosition.offset);
            }
        });
    }

    private registerEditingDowncast() {
        const editor = this.editor;
        const t = editor.t;
        editor.conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.aside,
            view: (_aside, { writer }) => {
                const aside = writer.createContainerElement("aside");
                writer.setCustomProperty(ASIDE_WIDGET_PROPERTY, true, aside);
                return toWidget(aside, writer, { label: t("Aside"), hasSelectionHandle: true });
            }
        });
        editor.conversion.for("editingDowncast").elementToElement({
            model: ELEMENTS.content,
            view: (_content, { writer }) => {
                const content: ViewEditableElement & PlaceholderableViewElement =
                    writer.createEditableElement("div", { class: CONTENT_CLASS });
                content.placeholder = t("Type the content of the aside");
                enableViewPlaceholder({
                    view: editor.editing.view,
                    element: content,
                    isDirectHost: false,
                    keepOnFocus: true
                });
                return toWidgetEditable(content, writer, { label: t("Aside") });
            }
        });
    }

    /**
     * Keeps every aside valid however it was produced (paste, import, undo): it has one content,
     * which holds at least one block. An aside cannot hold another, so one inside an aside, as a
     * paste or a drop can put it, is replaced by its blocks.
     */
    private registerPostFixer() {
        const model = this.editor.model;
        model.document.registerPostFixer((writer) => {
            const asides = new Set<ModelElement>();
            for (const change of model.document.differ.getChanges()) {
                if (change.type === "attribute") {
                    continue;
                }
                collectAsidesAround(change.position, asides);
                if (change.type === "insert") {
                    collectAsidesWithin(change.position.nodeAfter, asides);
                }
            }

            let changed = false;
            for (const aside of asides) {
                changed = fixAside(writer, aside) || changed;
            }
            return changed;
        });
    }
}

function isAsideWidget(element: ViewElement) {
    return !!element.getCustomProperty(ASIDE_WIDGET_PROPERTY);
}

function collectAsidesAround(position: ModelPosition, asides: Set<ModelElement>) {
    for (const ancestor of position.getAncestors()) {
        if (ancestor.is("element", ELEMENTS.aside)) {
            asides.add(ancestor);
        }
    }
}

function collectAsidesWithin(node: ModelNode | null, asides: Set<ModelElement>) {
    if (!node?.is("element")) {
        return;
    }
    if (node.is("element", ELEMENTS.aside)) {
        asides.add(node);
    }
    for (const child of node.getChildren()) {
        collectAsidesWithin(child, asides);
    }
}

function fixAside(writer: ModelWriter, aside: ModelElement): boolean {
    const [ content, ...others ] = aside.getChildren() as IterableIterator<ModelElement>;
    if (aside.findAncestor(ELEMENTS.content)) {
        for (const child of [ ...aside.getChildren() ] as ModelElement[]) {
            writer.move(writer.createRangeIn(child), writer.createPositionBefore(aside));
        }
        writer.remove(aside);
        return true;
    }

    if (!content) {
        const added = writer.createElement(ELEMENTS.content);
        writer.appendElement("paragraph", added);
        writer.append(added, aside);
        return true;
    }

    let changed = false;
    for (const other of others) {
        writer.move(writer.createRangeIn(other), writer.createPositionAt(content, "end"));
        writer.remove(other);
        changed = true;
    }
    if (content.isEmpty) {
        writer.appendElement("paragraph", content);
        changed = true;
    }
    return changed;
}
