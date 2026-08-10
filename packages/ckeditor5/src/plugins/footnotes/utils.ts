import { type Editor, ModelElement, ViewElement } from "ckeditor5";

/**
 * Returns an array of all descendant elements of the root for which the provided predicate
 * returns true.
 */
export const modelQueryElementsAll = (
    editor: Editor,
    rootElement: ModelElement,
    predicate: (item: ModelElement) => boolean = () => true
): Array<ModelElement> => {
    const range = editor.model.createRangeIn(rootElement);
    const output: Array<ModelElement> = [];

    for (const item of range.getItems()) {
        if (item instanceof ModelElement && predicate(item)) {
            output.push(item);
        }
    }

    return output;
};

/**
 * Returns the first descendant element of the root for which the provided predicate returns true,
 * or null if no such element is found.
 */
export const modelQueryElement = (
    editor: Editor,
    rootElement: ModelElement,
    predicate: (item: ModelElement) => boolean = () => true
): ModelElement | null => {
    const range = editor.model.createRangeIn(rootElement);

    for (const item of range.getItems()) {
        if (item instanceof ModelElement && predicate(item)) {
            return item;
        }
    }

    return null;
};

/**
 * Returns the first descendant element of the view root for which the provided predicate returns
 * true, or null if no such element is found.
 */
export const viewQueryElement = (
    editor: Editor,
    rootElement: ViewElement,
    predicate: (item: ViewElement) => boolean = () => true
): ViewElement | null => {
    const range = editor.editing.view.createRangeIn(rootElement);

    for (const item of range.getItems()) {
        if (item instanceof ViewElement && predicate(item)) {
            return item;
        }
    }

    return null;
};
