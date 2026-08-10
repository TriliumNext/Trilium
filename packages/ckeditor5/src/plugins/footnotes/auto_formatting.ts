import { Autoformat, type Editor, inlineAutoformatEditing, type ModelElement, type ModelRange, ModelText, ModelTextProxy } from "ckeditor5";

import { COMMANDS, ELEMENTS } from "./constants.js";
import { modelQueryElement, modelQueryElementsAll } from "./utils.js";

/**
 * Adds support for creating footnotes using markdown syntax, e.g. `[^1]`.
 */
export const addFootnoteAutoformatting = (editor: Editor, rootElement: ModelElement): void => {
    const autoformat = editor.plugins.get(Autoformat);

    inlineAutoformatEditing(
        editor,
        autoformat,
        (text) => regexMatchCallback(editor, text),
        (_writer, ranges: Array<ModelRange>) => formatCallback(ranges, editor, rootElement)
    );
};

/**
 * CKEditor's autoformatting feature (basically find and replace) has two opinionated default modes:
 * block autoformatting, which replaces the entire line, and inline autoformatting, which expects a
 * section to be formatted (but, importantly, not removed) surrounded by a pair of delimiters which
 * get removed.
 *
 * Neither is ideal here: the matched text should be replaced with a new element, without deleting
 * the entire line. `inlineAutoformatEditing` does allow passing a custom callback to handle regex
 * matching, which also allows specifying which sections to remove and which to pass on to the
 * formatting callback. This removes the entire matched text, while passing the range of the numeric
 * text on to the formatting callback.
 *
 * If 0 or more than 1 match is found, it returns empty ranges for both format and remove, a no-op.
 */
const regexMatchCallback = (
    editor: Editor,
    text: string
): {
    remove: Array<[number, number]>;
    format: Array<[number, number]>;
} => {
    const noMatch = { remove: [], format: [] };
    const selectionStart = editor.model.document.selection.anchor;
    // Get the text node containing the cursor's position, or the one ending at it.
    const surroundingText = selectionStart && (selectionStart.textNode || selectionStart.getShiftedBy(-1).textNode);

    /* v8 ignore next 3 -- defensive: the matcher only runs off typed text, so the selection
       anchor always sits in or right after a text node */
    if (!selectionStart || !surroundingText) {
        return noMatch;
    }

    for (const result of text.matchAll(/\[\^([0-9]+)\]/g)) {
        const removeStartIndex = text.indexOf(result[0]);
        const removeEndIndex = removeStartIndex + result[0].length;
        const textNodeOffset = selectionStart.parent.getChildStartOffset(surroundingText);

        // If the cursor isn't at the end of the range to be replaced, do nothing.
        if (textNodeOffset === null || selectionStart.offset !== textNodeOffset + removeEndIndex) {
            continue;
        }

        const formatStartIndex = removeStartIndex + 2;
        const formatEndIndex = formatStartIndex + result[1].length;
        return {
            remove: [[removeStartIndex, removeEndIndex]],
            format: [[formatStartIndex, formatEndIndex]]
        };
    }

    return noMatch;
};

/**
 * Takes a range of text passed on by {@link regexMatchCallback} and attempts to insert a
 * corresponding footnote reference at the current location.
 *
 * Footnotes only get inserted if the matching range is an integer between 1 and the number of
 * existing footnotes + 1.
 */
const formatCallback = (
    ranges: Array<ModelRange>,
    editor: Editor,
    rootElement: ModelElement
): boolean | undefined => {
    const command = editor.commands.get(COMMANDS.insertFootnote);
    if (!command || !command.isEnabled) {
        return;
    }

    const text = [...ranges[0].getItems()][0];
    /* v8 ignore next 3 -- defensive: the range handed over by regexMatchCallback always spans the
       digits it captured, so its first item is always text */
    if (!(text instanceof ModelTextProxy || text instanceof ModelText)) {
        return false;
    }

    // The range handed over by `regexMatchCallback` is exactly the digits captured by its pattern.
    const footnoteIndex = parseInt(text.data);
    const footnoteSection = modelQueryElement(editor, rootElement, (element) =>
        element.is("element", ELEMENTS.footnoteSection)
    );

    if (!footnoteSection) {
        if (footnoteIndex !== 1) {
            return false;
        }
        editor.execute(COMMANDS.insertFootnote);
        return;
    }

    const footnoteCount = modelQueryElementsAll(editor, footnoteSection, (element) =>
        element.is("element", ELEMENTS.footnoteItem)
    ).length;

    if (footnoteIndex === footnoteCount + 1) {
        editor.execute(COMMANDS.insertFootnote);
        return;
    }

    if (footnoteIndex >= 1 && footnoteIndex <= footnoteCount) {
        editor.execute(COMMANDS.insertFootnote, { footnoteIndex });
        return;
    }

    return false;
};
