import clsx from "clsx";
import type { RefObject, TargetedPointerEvent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { useTriliumEvent } from "../../react/hooks/events";
import { RawHtmlBlock } from "../../react/RawHtml";
import type { InkTextBox } from "./ink_document";

const loadTextBoxEditor = () => import("./TextBoxEditor");
const TextBoxEditor = lazy(loadTextBoxEditor);

/** The width of a new text box and the narrowest one, in world units. */
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 80;

interface TextBoxLayerProps {
    /** The handwriting note, under which the text note of each box is created. */
    noteId: string | undefined;
    /** The element that the view of the surface moves and scales, as `Handwriting` places it. */
    layerRef: RefObject<HTMLDivElement | null>;
    boxes: InkTextBox[];
    /** Whether a press on the paper adds a text box, as with the text tool. */
    isAdding: boolean;
    /** Whether the boxes take presses: to select, move and edit them. Otherwise the pen writes through them. */
    isInteractive: boolean;
    /** Returns the point of the paper under a point of the window, in world units. */
    toWorld(clientX: number, clientY: number): { x: number, y: number };
    getZoom(): number;
    onChange(boxes: InkTextBox[]): void;
}

/**
 * The text boxes of a handwriting note, over the paper and the ink. Each box shows a text note,
 * a child of the handwriting note, and edits it in place with the text editor.
 *
 * A prototype: the boxes have no undo, are not part of the thumbnail and lie over the ink.
 */
export default function TextBoxLayer({
    noteId, layerRef, boxes, isAdding, isInteractive, toWorld, getZoom, onChange
}: TextBoxLayerProps) {
    const [ selectedId, setSelectedId ] = useState<string>();
    const [ editedId, setEditedId ] = useState<string>();
    const boxesRef = useRef(boxes);
    boxesRef.current = boxes;

    useEffect(() => {
        if (isInteractive) {
            // Loads the text editor before the first box is opened.
            void loadTextBoxEditor();
            return;
        }
        setSelectedId(undefined);
        setEditedId(undefined);
    }, [ isInteractive ]);

    // A press outside the boxes lets go of the selection and finishes the edit.
    useEffect(() => {
        if (!selectedId && !editedId) return;
        const onPointerDown = (e: PointerEvent) => {
            if (isInTextBox(e.target) || isEditorPopup(e.target)) return;
            setSelectedId(undefined);
            setEditedId(undefined);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [ selectedId, editedId ]);

    async function addBox(clientX: number, clientY: number) {
        if (!noteId) return;
        const { x, y } = toWorld(clientX, clientY);
        const { note } = await server.post<{ note: { noteId: string } }>(
            `notes/${noteId}/children?target=into`,
            { title: t("handwriting.text_box_title"), content: "", type: "text" }
        );
        onChange([ ...boxesRef.current, { noteId: note.noteId, x, y, width: DEFAULT_WIDTH } ]);
        setSelectedId(note.noteId);
        setEditedId(note.noteId);
    }

    function updateBox(box: InkTextBox, changes: Partial<InkTextBox>) {
        onChange(boxesRef.current.map((other) => (other.noteId === box.noteId ? { ...other, ...changes } : other)));
    }

    return (
        <>
            {isAdding && (
                <div
                    className="handwriting-text-catcher"
                    onClick={(e) => void addBox(e.clientX, e.clientY)}
                />
            )}
            <div ref={layerRef} className="handwriting-text-layer">
                {boxes.map((box) => (
                    <TextBox
                        key={box.noteId}
                        box={box}
                        isInteractive={isInteractive}
                        isSelected={selectedId === box.noteId}
                        isEditing={editedId === box.noteId}
                        getZoom={getZoom}
                        onSelect={() => setSelectedId(box.noteId)}
                        onEdit={(isEditing) => setEditedId(isEditing ? box.noteId : undefined)}
                        onChange={(changes) => updateBox(box, changes)}
                        onDelete={() => onChange(boxesRef.current.filter((other) => other.noteId !== box.noteId))}
                    />
                ))}
            </div>
        </>
    );
}

/** Whether `target` is inside a text box, whose keys and presses are not the surface's. */
export function isInTextBox(target: EventTarget | null) {
    return target instanceof Element && !!target.closest(".handwriting-text-box");
}

/** Whether `target` is in a toolbar or a panel of the text editor, which float outside the box. */
function isEditorPopup(target: EventTarget | null) {
    return target instanceof Element && !!target.closest(".ck-body-wrapper, .ck-balloon-panel, .dropdown-menu");
}

interface TextBoxProps {
    box: InkTextBox;
    isInteractive: boolean;
    isSelected: boolean;
    isEditing: boolean;
    getZoom(): number;
    onSelect(): void;
    onEdit(isEditing: boolean): void;
    onChange(changes: Partial<InkTextBox>): void;
    onDelete(): void;
}

function TextBox({
    box, isInteractive, isSelected, isEditing, getZoom, onSelect, onEdit, onChange, onDelete
}: TextBoxProps) {
    const note = useTextNote(box.noteId);
    /** Counts the saves of the editor, each of which renders the note again. */
    const [ version, setVersion ] = useState(0);
    /** Whether the editor holds the content of the note, and so shows in place of the rendered text. */
    const [ isEditorReady, setEditorReady ] = useState(false);
    /** The content of the editor that closed, shown until its save lands and the note is rendered again. */
    const [ closingContent, setClosingContent ] = useState<string>();
    useEffect(() => {
        if (!isEditing) setEditorReady(false);
    }, [ isEditing ]);
    const startMove = useDrag(getZoom, (dx, dy, start) => onChange({ x: start.x + dx, y: start.y + dy }));
    const startResize = useDrag(getZoom, (dx, _dy, start) => onChange({ width: Math.max(MIN_WIDTH, start.width + dx) }));

    return (
        <div
            className={clsx(
                "handwriting-text-box",
                isInteractive && "interactive", isSelected && "selected",
                isEditing && isEditorReady && "editing"
            )}
            style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px` }}
            onPointerDown={() => {
                if (!isSelected) onSelect();
            }}
            onDblClick={() => {
                if (!isEditing && note) onEdit(true);
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape" && !e.defaultPrevented && isEditing) {
                    e.preventDefault();
                    onEdit(false);
                }
            }}
        >
            {isSelected && (
                <div className="handwriting-text-box-bar" onPointerDown={(e) => startMove(e, box)}>
                    <span className="bx bx-move" />
                    <button
                        type="button"
                        className="bx bx-trash"
                        title={t("handwriting.delete_text_box")}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={onDelete}
                    />
                </div>
            )}
            {note && isEditing && (
                <div className={clsx("handwriting-text-editor-host", !isEditorReady && "pending")}>
                    <Suspense fallback={null}>
                        <TextBoxEditor
                            note={note}
                            onReady={() => setEditorReady(true)}
                            onClose={(content, save) => {
                                setClosingContent(content);
                                void save.finally(() => {
                                    setClosingContent(undefined);
                                    setVersion((current) => current + 1);
                                });
                            }}
                        />
                    </Suspense>
                </div>
            )}
            {note && !(isEditing && isEditorReady) && (
                <TextPreview note={note} version={version} closingContent={closingContent} />
            )}
            {note === null && <div className="handwriting-text-missing">{t("handwriting.text_box_missing")}</div>}
            {isSelected && (
                <div className="handwriting-text-box-resize" onPointerDown={(e) => startResize(e, box)} />
            )}
        </div>
    );
}

interface TextPreviewProps {
    note: FNote;
    version: number;
    /** The content to show in place of the note's, which the editor that closed is still saving. */
    closingContent: string | undefined;
}

/** The rendered content of `note`, or a hint for an empty one. */
function TextPreview({ note, version, closingContent }: TextPreviewProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [ reloads, setReloads ] = useState(0);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteContentReloaded(note.noteId)) setReloads((current) => current + 1);
    });

    useEffect(() => {
        if (closingContent !== undefined) return;
        let isStale = false;
        void content_renderer.getRenderedContent(note).then(({ $renderedContent }) => {
            if (isStale || !ref.current) return;
            const rendered = $renderedContent[0];
            if (rendered?.textContent?.trim() || rendered?.querySelector("img, table, hr")) {
                ref.current.replaceChildren(rendered);
            } else {
                ref.current.textContent = t("handwriting.text_box_empty");
                ref.current.classList.add("empty");
                return;
            }
            ref.current.classList.remove("empty");
        });
        return () => {
            isStale = true;
        };
    }, [ note, version, reloads, closingContent ]);

    if (closingContent !== undefined) {
        return (
            <div className="handwriting-text-preview">
                <RawHtmlBlock className="ck-content" html={closingContent} />
            </div>
        );
    }
    return <div ref={ref} className="handwriting-text-preview" />;
}

/** The text note `noteId`, `undefined` while it loads and `null` when it is gone. */
function useTextNote(noteId: string) {
    const [ note, setNote ] = useState<FNote | null>();
    useEffect(() => {
        let isStale = false;
        void froca.getNote(noteId, true).then((loaded) => {
            if (!isStale) setNote(loaded ?? null);
        });
        return () => {
            isStale = true;
        };
    }, [ noteId ]);
    return note;
}

/**
 * Returns the `pointerdown` handler of a handle that drags a box. `onDrag` gets how far the
 * pointer went since the press, in world units, and the box as it was at the press.
 */
function useDrag(getZoom: () => number, onDrag: (dx: number, dy: number, start: InkTextBox) => void) {
    const onDragRef = useRef(onDrag);
    onDragRef.current = onDrag;

    return (e: TargetedPointerEvent<HTMLElement>, start: InkTextBox) => {
        const handle = e.currentTarget;
        const { clientX, clientY, pointerId } = e;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(pointerId);
        const onMove = (move: PointerEvent) => {
            if (move.pointerId !== pointerId) return;
            const zoom = getZoom();
            onDragRef.current((move.clientX - clientX) / zoom, (move.clientY - clientY) / zoom, start);
        };
        const onEnd = (end: PointerEvent) => {
            if (end.pointerId !== pointerId) return;
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onEnd);
            handle.removeEventListener("pointercancel", onEnd);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onEnd);
        handle.addEventListener("pointercancel", onEnd);
    };
}
