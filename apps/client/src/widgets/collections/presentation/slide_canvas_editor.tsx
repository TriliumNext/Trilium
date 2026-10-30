import "./slide_canvas_editor.css";

import { useLayoutEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import { useNoteContext } from "../../react/hooks";
import Canvas from "../../type_widgets/canvas/Canvas";
import { getCanvasEditorSlotName } from "./slides";

interface SlideCanvasEditorProps {
    note: FNote;
    onFinish(): void;
}

/**
 * Edits a canvas slide in place with Excalidraw, in a note context of its own that saves the canvas
 * as a note tab does. The editor goes in the `<slot>` of the slide, outside the shadow root, where the
 * document's stylesheets style Excalidraw, and covers the presentation's viewport.
 *
 * Keys stay in the editor, so that Reveal.js does not act on them. Escape finishes editing, unless
 * Excalidraw already handled it.
 */
export default function SlideCanvasEditor({ note, onFinish }: SlideCanvasEditorProps) {
    const { noteContext, component, ntxId } = useEmbeddedNoteContext(note, "_slide", { skipRecentNotes: true });

    // A layout cleanup runs while Excalidraw is still mounted, so it saves what is left.
    useLayoutEffect(() => () => void announceEmbeddedNoteClosing(component, ntxId), [ component, ntxId ]);

    return (
        <div
            slot={getCanvasEditorSlotName(note.noteId)}
            className="presentation-canvas-slide"
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape" && !e.defaultPrevented) {
                    e.preventDefault();
                    onFinish();
                }
            }}
        >
            <EmbeddedNoteScope component={component} noteContext={noteContext}>
                <ScopedCanvas note={note} />
            </EmbeddedNoteScope>
        </div>
    );
}

/** The canvas, once the note context of the editor holds `note`. */
function ScopedCanvas({ note }: { note: FNote }) {
    const { note: contextNote, noteContext, ntxId, parentComponent } = useNoteContext();
    if (!noteContext || contextNote?.noteId !== note.noteId) return null;
    return (
        <Canvas
            note={note}
            noteContext={noteContext}
            ntxId={ntxId}
            parentComponent={parentComponent}
            viewScope={noteContext.viewScope}
        />
    );
}
