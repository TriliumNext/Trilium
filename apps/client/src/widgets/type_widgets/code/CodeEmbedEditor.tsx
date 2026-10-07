import type VanillaCodeMirror from "@triliumnext/codemirror";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import {
    useNoteLabelInt, useNoteLabelOptionalBool, useTriliumOptionBool
} from "../../react/hooks";
import { CodeEditor } from "./Code";

export interface CodeEmbedEditorProps {
    note: FNote | null;
    editor: ContentEditor;
    content: string;
    mime: string;
    /** Receives the edited content when the editor goes away. */
    onClose: (content: string) => void;
}

/** CodeMirror over the content of a code embed, which `editor` saves as it changes. */
export default function CodeEmbedEditor({
    note, editor, content, mime, onClose
}: CodeEmbedEditorProps) {
    const viewRef = useRef<VanillaCodeMirror>(null);
    const isLoadingRef = useRef(false);
    const [ vimKeymapEnabled ] = useTriliumOptionBool("vimKeymapEnabled");
    const [ noteTabWidth ] = useNoteLabelInt(note, "tabWidth");
    const [ noteUseTabs ] = useNoteLabelOptionalBool(note, "indentWithTabs");
    const [ noteWrapLines ] = useNoteLabelOptionalBool(note, "wrapLines");

    // Runs after the effects of `CodeMirror`, which empties the document as it mounts.
    useEffect(() => {
        const view = viewRef.current;
        if (!view || view.getText() === content) return;

        // Loading changes the document as well, which must not schedule a save.
        isLoadingRef.current = true;
        view.setText(content);
        isLoadingRef.current = false;
        view.clearHistory();
    }, [ content ]);

    // A layout cleanup runs during the unmount, before CodeMirror is destroyed.
    useLayoutEffect(() => () => {
        const text = viewRef.current?.getText();
        editor.release();
        if (text !== undefined) {
            onClose(text);
        }
    }, [ editor, onClose ]);

    return (
        <CodeEditor
            ntxId={null}
            editorRef={viewRef}
            className="code-embed-editor"
            mime={mime}
            vimKeybindings={vimKeymapEnabled}
            onContentChanged={() => {
                if (!isLoadingRef.current) {
                    editor.scheduleSave(() => viewRef.current?.getText() ?? "");
                }
            }}
            {...(noteTabWidth != null && { indentSize: noteTabWidth })}
            {...(noteUseTabs != null && { useTabs: noteUseTabs })}
            {...(noteWrapLines != null && { lineWrapping: noteWrapLines })}
        />
    );
}
