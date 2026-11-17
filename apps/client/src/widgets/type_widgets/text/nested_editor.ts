import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { useEffect, useState } from "preact/hooks";

/** The editable root of a text editor, which CKEditor gives a reference to the editor. */
export type EditorRootElement = HTMLElement & { ckeditorInstance?: CKTextEditor };

export const EDITOR_ROOT_SELECTOR = ".ck-editor__editable:not(.ck-editor__nested-editable)";

/**
 * The text editor nested in the split of `ntxId`, such as the editor of an included note, while it
 * holds the focus, for the formatting toolbar to show its buttons. `null` once the editor of the
 * note takes the focus, or the nested editor goes away. Focus elsewhere, such as in the toolbar,
 * changes nothing.
 */
export function useNestedEditor(ntxId: string | null | undefined) {
    const [ editor, setEditor ] = useState<CKTextEditor | null>(null);

    useEffect(() => {
        setEditor(null);
        if (!ntxId) return;

        let stopWatching: (() => void) | undefined;
        const onFocusIn = (event: FocusEvent) => {
            const editable = event.target instanceof Element
                ? event.target.closest<EditorRootElement>(EDITOR_ROOT_SELECTOR)
                : null;
            if (editable?.closest<HTMLElement>("[data-ntx-id]")?.dataset.ntxId !== ntxId) return;

            stopWatching?.();
            stopWatching = undefined;
            const focused = editable.ckeditorInstance;
            if (!focused || !editable.parentElement?.closest(EDITOR_ROOT_SELECTOR)) {
                setEditor(null);
                return;
            }

            const release = () => setEditor(null);
            focused.on("destroy", release);
            stopWatching = () => focused.off("destroy", release);
            setEditor(focused);
        };

        document.addEventListener("focusin", onFocusIn);
        return () => {
            document.removeEventListener("focusin", onFocusIn);
            stopWatching?.();
        };
    }, [ ntxId ]);

    return editor;
}
