let $lastFocusedElement: JQuery<HTMLElement> | null;

// undefined = unset, distinct from a null ntxId.
let pendingTitleFocusNtxId: string | null | undefined;
let pendingTitleFocusAt = 0;

// Bounded so a request that never resolves can't suppress focus changes forever.
const PENDING_TITLE_FOCUS_TIMEOUT_MS = 1500;

/** Marks a new note's title as about to be focused, so other async focus handlers can back off. */
export function markTitleFocusPending(ntxId: string | null) {
    pendingTitleFocusNtxId = ntxId;
    pendingTitleFocusAt = Date.now();
}

/** True if a title-focus request for `ntxId` (or any, if omitted) is still pending. */
export function isTitleFocusPending(ntxId?: string | null) {
    if (pendingTitleFocusNtxId === undefined) {
        return false;
    }

    if (Date.now() - pendingTitleFocusAt > PENDING_TITLE_FOCUS_TIMEOUT_MS) {
        pendingTitleFocusNtxId = undefined;
        return false;
    }

    return ntxId === undefined || ntxId === pendingTitleFocusNtxId;
}

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
        $lastFocusedElement.focus();
    }

    $lastFocusedElement = null;
}
