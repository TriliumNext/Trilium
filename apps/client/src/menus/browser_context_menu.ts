/**
 * Puts Trilium's menu over the browser's own wherever the pointer sits on a selection. A click at a
 * bare caret keeps the native menu, the only way to spelling corrections and the browser's paste.
 * Electron replaces the menu everywhere; see `electron_context_menu.ts`. The menu's module,
 * `note_context_menu.ts`, loads on the first right-click that this claims.
 */
export function setupContextMenu() {
    document.addEventListener("contextmenu", (event) => {
        // A widget that answers the click itself — the note tree, an internal link — has already
        // put its own menu up.
        if (event.defaultPrevented) {
            return;
        }

        // Shift+right-click is Firefox's own way back to the browser's menu; honoring it gives
        // Chrome and Safari, which have no bypass of their own, the same one.
        if (event.shiftKey) {
            return;
        }

        const element = event.target instanceof HTMLElement ? event.target : null;
        const isEditable = acceptsTyping(element);

        // `window.getSelection()` does not report a selection inside an `<input>` or `<textarea>`,
        // so those keep the browser's menu, which is the better one for a plain text field.
        // The clipboard and search rows act on the selection, so the pointer has to be on it: a
        // right-click on the surrounding UI, which takes no selection of its own, leaves an
        // earlier one standing.
        const selection = window.getSelection();
        const selectionText = selection?.toString() ?? "";
        const isOnSelection = !!selection && (isOnSelectedCodeLine(selection, element, isEditable)
            || (!!selectionText.trim()
                && isPointInSelection(selection, event.clientX, event.clientY)));

        // A table cell in the text editor is claimed even at a bare caret, for the table section.
        const isOnEditableTableCell = isEditable && !!element?.closest("td, th");

        if (!isOnSelection && !isOnEditableTableCell) {
            return;
        }

        // Claimed before the items are built: after an await the default action has already run.
        event.preventDefault();

        const link = element?.closest("a[href]");
        const target = {
            linkURL: link instanceof HTMLAnchorElement ? link.href : "",
            linkText: link?.textContent ?? "",
            isMedia: !!element?.closest("img, video, audio"),
            isEditable,
            // Claimed off the selection (a bare caret in a table cell), those rows get none.
            selectionText: isOnSelection ? selectionText : "",
            element
        };
        void import("./note_context_menu.js").then(({ showBrowserContextMenu }) =>
            showBrowserContextMenu(event.pageX, event.pageY, target));
    });
}

/**
 * Whether `element` is on a line of an editable code editor that `selection` touches. The whole
 * line counts, so that the text tools are reachable for a selection of blank lines or spaces.
 */
function isOnSelectedCodeLine(
    selection: Selection,
    element: HTMLElement | null,
    isEditable: boolean
) {
    const line = isEditable ? element?.closest(".cm-line") : null;
    return !!line && !selection.isCollapsed && selection.containsNode(line, true);
}

/** Whether the point (`x`, `y`), in viewport coordinates, lands on what `selection` highlights. */
function isPointInSelection(selection: Selection, x: number, y: number) {
    for (let i = 0; i < selection.rangeCount; i++) {
        for (const rect of Array.from(selection.getRangeAt(i).getClientRects())) {
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Whether `element` takes typing, which is what decides the rows that write to a note.
 *
 * `isContentEditable` alone does not answer it inside a code note. CodeMirror drives
 * `contenteditable` off its `editable` facet, which Trilium never lowers, and marks a read-only
 * note with `aria-readonly` on the same element instead — so the attribute is what tells the two
 * apart.
 */
function acceptsTyping(element: HTMLElement | null) {
    return !!element?.isContentEditable && !element.closest("[aria-readonly='true']");
}
