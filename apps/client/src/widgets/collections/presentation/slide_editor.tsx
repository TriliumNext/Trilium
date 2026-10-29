import { Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import TextEmbedEditor from "../../type_widgets/text/TextEmbedEditor";

/**
 * Edits a text slide in place, inside the slide's frame in the shadow root, so that the slide's
 * theme styles the text being edited. The editor's toolbars open in the document, as for any
 * floating toolbar. Escape finishes editing, unless the editor already handled it.
 */
export default function SlideEditor({ note, onFinish }: { note: FNote; onFinish(): void }) {
    const editorStylesheet = useEditorStylesheet();
    if (!editorStylesheet) return null;

    return (
        <div
            className="slide-editor-root"
            onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented) {
                    e.preventDefault();
                    onFinish();
                }
            }}
        >
            <style>{editorStylesheet}</style>
            <Suspense fallback={null}>
                <TextEmbedEditor note={note} hasFixedToolbar={false} onClose={() => {}} />
            </Suspense>
        </div>
    );
}

function useEditorStylesheet() {
    const [ stylesheet, setStylesheet ] = useState<string>();

    useEffect(() => {
        void import("@triliumnext/ckeditor5/src/editor_stylesheet").then(({ default: css }) => {
            // Without `:host`, the editor's tokens are inherited from the document, where
            // ckeditor-theme.css sets Trilium's values for them.
            setStylesheet(css.replaceAll(":root, :host {", ":root {"));
        });
    }, []);

    return stylesheet;
}
