import {
    type Model,
    type ModelElement,
    type ModelPosition,
    type ModelRange,
    type ModelSchema,
    Plugin,
    type ViewDocumentObserverSelectionChangeEvent
} from "ckeditor5";

/**
 * Widens a selection that leaves a nested limit element, such as a table or an image caption,
 * only as far as the innermost limit element that contains both ends: a column, a tab panel or a
 * table cell. CKEditor widens such a selection up to the root, which selects the whole outer block.
 */
export default class NestedLimitSelection extends Plugin {

    public static get pluginName() {
        return "NestedLimitSelection" as const;
    }

    public init(): void {
        const editor = this.editor;
        const model = editor.model;

        // Runs before the editing controller converts the selection, and so before the model
        // selection post-fixer widens it.
        this.listenTo<ViewDocumentObserverSelectionChangeEvent>(
            editor.editing.view.document,
            "selectionChange",
            (evt, data) => {
                const ranges = [...data.newSelection.getRanges()]
                    .map(range => editor.editing.mapper.toModelRange(range));
                const scoped = ranges.map(range => scopeRange(model, range));
                if (scoped.every((range, index) => range.isEqual(ranges[index]))) {
                    return;
                }

                const backward = data.newSelection.isBackward;
                model.change(writer => writer.setSelection(scoped, { backward }));
                evt.stop();
            },
            { priority: "high" }
        );
    }
}

/**
 * Moves each end of `range` that is inside a limit element below the range's own limit element to
 * just outside the outermost such element.
 */
export function scopeRange(model: Model, range: ModelRange): ModelRange {
    if (range.isCollapsed) {
        return range;
    }

    const schema = model.schema;
    const ceiling = schema.getLimitElement(range);
    const startLimit = getOutermostLimitBelow(schema, range.start, ceiling);
    const endLimit = getOutermostLimitBelow(schema, range.end, ceiling);
    if (!startLimit && !endLimit) {
        return range;
    }

    const start = startLimit ? model.createPositionBefore(startLimit) : range.start;
    const end = endLimit ? model.createPositionAfter(endLimit) : range.end;
    return model.createRange(start, end);
}

function getOutermostLimitBelow(
    schema: ModelSchema,
    position: ModelPosition,
    ceiling: ModelElement
): ModelElement | null {
    let outermost: ModelElement | null = null;
    for (const ancestor of position.getAncestors().reverse()) {
        if (ancestor === ceiling) {
            break;
        }
        if (ancestor.is("element") && schema.isLimit(ancestor)) {
            outermost = ancestor;
        }
    }
    return outermost;
}
