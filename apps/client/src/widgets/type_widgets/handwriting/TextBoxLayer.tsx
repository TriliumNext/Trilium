import clsx from "clsx";
import type { RefObject, TargetedPointerEvent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { isHtmlEmpty, randomString } from "../../../services/utils";
import { RawHtmlBlock } from "../../react/RawHtml";
import type { InkTextBox } from "./ink_document";

const loadTextBoxEditor = () => import("./TextBoxEditor");
const TextBoxEditor = lazy(loadTextBoxEditor);

/** The width of a new text box and the narrowest one, in world units. */
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 80;

interface TextBoxLayerProps {
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
 * The text boxes of a handwriting note, over the paper and the ink. The note holds the text of
 * each box as HTML, which the box edits in place with a text editor.
 *
 * A prototype: the boxes have no undo, are not part of the thumbnail and lie over the ink.
 */
export default function TextBoxLayer({
    layerRef, boxes, isAdding, isInteractive, toWorld, getZoom, onChange
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

    function setBoxes(next: InkTextBox[]) {
        boxesRef.current = next;
        onChange(next);
    }

    function addBox(clientX: number, clientY: number) {
        const { x, y } = toWorld(clientX, clientY);
        const id = randomString(10);
        setBoxes([ ...boxesRef.current, { id, x, y, width: DEFAULT_WIDTH, html: "" } ]);
        setSelectedId(id);
        setEditedId(id);
    }

    return (
        <>
            {isAdding && (
                <div className="handwriting-text-catcher" onClick={(e) => addBox(e.clientX, e.clientY)} />
            )}
            <div ref={layerRef} className="handwriting-text-layer">
                {boxes.map((box) => (
                    <TextBox
                        key={box.id}
                        box={box}
                        isInteractive={isInteractive}
                        isSelected={selectedId === box.id}
                        isEditing={editedId === box.id}
                        getZoom={getZoom}
                        onSelect={() => setSelectedId(box.id)}
                        onEdit={(isEditing) => setEditedId(isEditing ? box.id : undefined)}
                        onChange={(changes) => setBoxes(boxesRef.current.map((other) => (
                            other.id === box.id ? { ...other, ...changes } : other
                        )))}
                        onDelete={() => setBoxes(boxesRef.current.filter((other) => other.id !== box.id))}
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
    /** Whether the editor shows the text, and so stands in place of the rendered text. */
    const [ isEditorReady, setEditorReady ] = useState(false);
    const startMove = useDrag(getZoom, (dx, dy, start) => onChange({ x: start.x + dx, y: start.y + dy }));
    const startResize = useDrag(getZoom, (dx, _dy, start) => onChange({ width: Math.max(MIN_WIDTH, start.width + dx) }));
    const htmlRef = useRef(box.html);
    htmlRef.current = box.html;
    const onDeleteRef = useRef(onDelete);
    onDeleteRef.current = onDelete;

    // A box left without text goes away, so that pressing around with the text tool leaves none.
    useEffect(() => {
        if (!isEditing) return;
        return () => {
            setEditorReady(false);
            if (isHtmlEmpty(htmlRef.current)) onDeleteRef.current();
        };
    }, [ isEditing ]);

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
                if (!isEditing) onEdit(true);
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
            {isEditing && (
                <div className={clsx("handwriting-text-editor-host", !isEditorReady && "pending")}>
                    <Suspense fallback={null}>
                        <TextBoxEditor
                            html={box.html}
                            onReady={() => setEditorReady(true)}
                            onChange={(html) => onChange({ html })}
                        />
                    </Suspense>
                </div>
            )}
            {!(isEditing && isEditorReady) && <TextPreview html={box.html} isOpening={isEditing} />}
            {isSelected && (
                <div className="handwriting-text-box-resize" onPointerDown={(e) => startResize(e, box)} />
            )}
        </div>
    );
}

/**
 * The text of a box as it is shown while it is not edited, or a hint for a box without text. A
 * box without text whose editor `isOpening` shows an empty line, as the editor will.
 */
function TextPreview({ html, isOpening }: { html: string, isOpening: boolean }) {
    if (isHtmlEmpty(html)) {
        return (
            <div className="handwriting-text-preview empty">
                {isOpening ? "\u00a0" : t("handwriting.text_box_empty")}
            </div>
        );
    }
    // The HTML comes from the saved note, which a sync or an import can have written.
    return (
        <div className="handwriting-text-preview">
            <RawHtmlBlock className="ck-content" html={sanitizeNoteContentHtml(html)} />
        </div>
    );
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
