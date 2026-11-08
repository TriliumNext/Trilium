deferSelectionChange();

/**
 * Fires `selectionchange` after the code that moved the selection, as browsers do.
 *
 * happy-dom dispatches it from inside `Selection.collapse()`. CodeMirror moves the DOM selection
 * during `EditorView.update()`, and its listener updates the view again, which throws
 * "Calls to EditorView.update are not allowed while an update is in progress".
 */
function deferSelectionChange() {
    const dispatch = document.dispatchEvent.bind(document);
    // happy-dom's `dispatchEvent()` calls itself again for each event phase.
    const deferred = new WeakSet<Event>();

    document.dispatchEvent = (event: Event) => {
        if (event.type !== "selectionchange" || deferred.has(event)) {
            return dispatch(event);
        }

        deferred.add(event);
        queueMicrotask(() => dispatch(event));
        return true;
    };
}
