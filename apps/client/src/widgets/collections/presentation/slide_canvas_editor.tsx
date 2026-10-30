import "./slide_canvas_editor.css";

import type {
    ExcalidrawImperativeAPI, ExcalidrawInitialDataState, NormalizedZoomValue
} from "@excalidraw/excalidraw/types";
import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext } from "../../EmbeddedNotePane";
import { useColorScheme, useEffectiveReadOnly, useNoteContext } from "../../react/hooks";
import { CanvasEditor } from "../../type_widgets/canvas/Canvas";
import { CanvasNoteMenu } from "../../type_widgets/canvas/CanvasDrawingMenu";
import { getCenteredView } from "../../type_widgets/canvas/drawing_view";
import useCanvasPersistence from "../../type_widgets/canvas/persistence";
import { drawPicture } from "../../type_widgets/canvas/picture_schedule";
import { getCanvasEditorSlotName } from "./slides";

interface SlideCanvasEditorProps {
    note: FNote;
    /** How much Reveal.js scales the slides, which the editor zooms the drawing by. */
    scale: number;
    onFinish(): void;
}

/**
 * Edits a canvas slide in place with Excalidraw, in a note context of its own that saves the canvas
 * as a note tab does. The editor goes in the `<slot>` of the slide, outside the shadow root, where the
 * document's stylesheets style Excalidraw, and covers the presentation's viewport. It opens on the
 * drawing as the slide shows it, with {@link viewAsOnSlide}.
 *
 * Keys stay in the editor, so that Reveal.js does not act on them. Escape finishes editing, unless
 * Excalidraw already handled it.
 */
export default function SlideCanvasEditor({ note, scale, onFinish }: SlideCanvasEditorProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const { noteContext, component, ntxId } = useEmbeddedNoteContext(note, "_slide", { skipRecentNotes: true });

    // A layout cleanup runs while Excalidraw is still mounted, so it saves what is left. The slide
    // shows the picture of the canvas, which the save schedules, so it is drawn at once.
    useLayoutEffect(() => () => {
        void (async () => {
            await announceEmbeddedNoteClosing(component, ntxId);
            drawPicture(note.noteId);
        })();
    }, [ component, ntxId ]);

    return (
        <div
            ref={rootRef}
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
                <ScopedCanvas note={note} scale={scale} rootRef={rootRef} />
            </EmbeddedNoteScope>
        </div>
    );
}

interface ScopedCanvasProps {
    note: FNote;
    scale: number;
    rootRef: RefObject<HTMLDivElement | null>;
}

/** The canvas, once the note context of the editor holds `note`. */
function ScopedCanvas(props: ScopedCanvasProps) {
    const { note: contextNote, noteContext } = useNoteContext();
    if (!noteContext || contextNote?.noteId !== props.note.noteId) return null;
    return <SlideCanvas {...props} noteContext={noteContext} />;
}

function SlideCanvas({ note, scale, rootRef, noteContext }: ScopedCanvasProps & { noteContext: NoteContext }) {
    const apiRef = useRef<ExcalidrawImperativeAPI>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const colorScheme = useColorScheme();
    const persistence = useCanvasPersistence(note, noteContext, apiRef, colorScheme, isReadOnly);
    // Excalidraw reads `initialData` once, as it mounts.
    const [ initialData ] = useState(async () => {
        const loaded = persistence.initialData;
        const data = await (typeof loaded === "function" ? loaded() : loaded);
        const root = rootRef.current;
        return data && root ? viewAsOnSlide(data, scale, root.offsetWidth, root.offsetHeight) : data ?? null;
    });

    return (
        <CanvasEditor
            apiRef={apiRef}
            isReadOnly={isReadOnly}
            colorScheme={colorScheme}
            persistence={{ ...persistence, initialData }}
            isEmbedded
            isDesktopLayout
        >
            <CanvasNoteMenu />
        </CanvasEditor>
    );
}

/**
 * Returns `data` with a view of its drawing as the slide shows it, in an editor of `width` × `height`
 * that covers the presentation's viewport: zoomed by the `scale` of the slides, and centered, as the
 * slide centers the picture of the drawing.
 */
function viewAsOnSlide(
    data: ExcalidrawInitialDataState, scale: number, width: number, height: number
): ExcalidrawInitialDataState {
    const zoom = { value: scale as NormalizedZoomValue };
    const view = getCenteredView(data.elements ?? [], { zoom, scrollX: 0, scrollY: 0 }, width, height) ?? { zoom };
    return { ...data, appState: { ...data.appState, ...view } };
}
