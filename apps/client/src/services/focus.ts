let $lastFocusedElement: JQuery<HTMLElement> | null;

// perhaps there should be saved focused element per tab?
export function saveFocusedElement() {
    $lastFocusedElement = $(":focus");
}

export function focusSavedElement() {
    if (!$lastFocusedElement) {
        return;
    }

    if ($lastFocusedElement.hasClass("ck")) {
        // must handle CKEditor separately because of this bug: https://github.com/ckeditor/ckeditor5/issues/607
        // the bug manifests itself in resetting the cursor position to the first character - jumping above

        const editor = $lastFocusedElement.closest(".ck-editor__editable").prop("ckeditorInstance");

        if (editor) {
            editor.editing.view.focus();
        } else {
            console.log("Could not find CKEditor instance to focus last element");
        }
    } else {
        // The user has not moved since the dialog opened, so the focus goes back without the
        // browser scrolling the element into view. Without `preventScroll`, restoring focus to a
        // tree node the user has since scrolled away from drags the tree back to it.
        $lastFocusedElement[0]?.focus({ preventScroll: true });
    }

    $lastFocusedElement = null;
}
