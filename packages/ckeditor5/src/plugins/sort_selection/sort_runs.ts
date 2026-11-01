import { autoSort } from "@triliumnext/commons";
import type { Editor, Model, ModelElement, ModelNode, ModelWriter } from "ckeditor5";

/** Sibling nodes from `first` to `last` that move as one, and the text they sort by. */
export interface SortRun {
    first: ModelNode;
    last: ModelNode;
    text: string;
}

/**
 * Sorts `runs` with `autoSort` in the content language of the editor, and moves them into the new
 * order in one undo step. The runs must be contiguous and in document order. Writes nothing when
 * the order does not change, and returns whether anything moved. `afterMove` runs in the same
 * change, with the runs in their new order.
 */
export function sortRuns(
    editor: Editor,
    runs: SortRun[],
    isDescending: boolean,
    afterMove?: (writer: ModelWriter, sorted: SortRun[]) => void
): boolean {
    const sorted = autoSort(runs, (run) => run.text, {
        locale: editor.locale.contentLanguage,
        isDescending,
        dateFormats: editor.config.get("autoSort")?.dateFormats
    });
    if (sorted.every((run, index) => run === runs[index])) {
        return false;
    }

    editor.model.change((writer) => {
        const regionStart = runs[0].first;
        let previous: SortRun | null = null;
        for (const run of sorted) {
            // The previous move shifts the nodes after it, so `insertAt` is read inside the loop.
            const insertAt = previous
                ? writer.createPositionAfter(previous.last)
                : writer.createPositionBefore(regionStart);
            // `writer.move()` skips a run that is already at `insertAt`.
            writer.move(writer.createRange(
                writer.createPositionBefore(run.first),
                writer.createPositionAfter(run.last)), insertAt);
            previous = run;
        }
        afterMove?.(writer, sorted);
    });
    return true;
}

/**
 * The plain text of `element`. Elements inside it, such as paragraphs and line breaks, are
 * spaces.
 */
export function blockText(model: Model, element: ModelElement): string {
    let text = "";
    for (const item of model.createRangeIn(element).getItems()) {
        text += item.is("$textProxy") ? item.data : " ";
    }
    return text;
}

/**
 * The text a block sorts by: the text of the first element in it, itself included, that can hold
 * text. A collapsible sorts by its title, a quote by its first paragraph, an image by its caption.
 * A block with no such element sorts as empty.
 */
export function unitText(model: Model, block: ModelElement): string {
    if (model.schema.checkChild(block, "$text")) {
        return blockText(model, block);
    }

    for (const item of model.createRangeIn(block).getItems()) {
        if (item.is("element") && model.schema.checkChild(item, "$text")) {
            return blockText(model, item);
        }
    }
    return "";
}
