import { type CKEditorError, type Editor, onEditorError } from "ckeditor5";

const IGNORED_ERRORS = [
    // See: https://github.com/TriliumNext/Trilium/issues/5776
    "TypeError: Cannot read properties of null (reading 'parent')",

    // See: https://github.com/TriliumNext/Trilium/issues/7739
    "model-nodelist-offset-out-of-bounds"
];

/**
 * Calls `callback` with each error that escapes `editor`, except the known errors in
 * `IGNORED_ERRORS`, and returns a function that stops the reporting.
 *
 * `onEditorError()` only reports: the editor keeps running after the error.
 */
export function onTextEditorError(editor: Editor, callback: (error: CKEditorError) => void) {
    return onEditorError(({ error, source }) => {
        if (source === editor && !isIgnoredError(error)) {
            callback(error);
        }
    });
}

function isIgnoredError(error: CKEditorError) {
    return IGNORED_ERRORS.some((ignoredError) => error.message.includes(ignoredError));
}
