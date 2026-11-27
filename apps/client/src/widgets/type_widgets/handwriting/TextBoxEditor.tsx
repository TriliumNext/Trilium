import { useEffect, useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { whenEditorHoldsContent } from "../../collections/presentation/slide_editor";
import TextEmbedEditor from "../text/TextEmbedEditor";

interface TextBoxEditorProps {
    note: FNote;
    /** Called once the editor holds the content of the note and can replace the rendered text. */
    onReady(): void;
    /** Receives the content of the editor as it goes away, and the save of what is left. */
    onClose(content: string, save: Promise<boolean>): void;
}

/**
 * The text editor of a text box. `TextBoxLayer` loads this module, and the text editor with it,
 * when a box can first be edited, and keeps the rendered text in view until `onReady`.
 */
export default function TextBoxEditor({ note, onReady, onClose }: TextBoxEditorProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
        if (!rootRef.current) return;
        return whenEditorHoldsContent(rootRef.current, note, () => onReadyRef.current());
    }, [ note ]);

    return (
        <div ref={rootRef} className="handwriting-text-editor">
            <TextEmbedEditor note={note} hasFixedToolbar={false} onClose={onClose} />
        </div>
    );
}
