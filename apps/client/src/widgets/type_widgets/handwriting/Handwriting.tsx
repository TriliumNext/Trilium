import "./Handwriting.css";

import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isIOS } from "../../../services/utils";
import ColorPicker from "../../react/ColorPicker";
import { useFullscreen } from "../../react/hooks/dom";
import { useEditorSpacedUpdate } from "../../react/hooks/editor";
import { useTriliumOptionBool } from "../../react/hooks/options";
import { useEffectiveReadOnly } from "../../react/hooks/note_context";
import OverlayControlGroup, {
    OverlayControlButton, OverlayControlDropdown, OverlayFullscreenButton, ZoomControls
} from "../../react/OverlayControlGroup";
import Slider from "../../react/Slider";
import { TypeWidgetProps } from "../type_widget";
import { AUTO_COLOR, type InkDocument, type InkView, PAPER_STYLES, parseInkDocument } from "./ink_document";
import InkSurface, { HIGHLIGHTER_WIDTH_FACTOR, type InkSurfaceState, type SurfaceTool } from "./ink_surface";

const TOOLS: { tool: SurfaceTool, icon: string, title: () => string }[] = [
    { tool: "pen", icon: "bx-pen", title: () => t("handwriting.pen") },
    { tool: "highlighter", icon: "bx-highlight", title: () => t("handwriting.highlighter") },
    { tool: "eraser", icon: "bx-eraser", title: () => t("handwriting.eraser") }
];

/** Whether the device has a touch screen, the only one on which fingers can draw. */
const HAS_TOUCH = navigator.maxTouchPoints > 0;

/** The view of each note left in this session, which reopening the note shows again. */
const sessionViews = new Map<string, InkView>();

export default function Handwriting({ note, noteContext }: TypeWidgetProps) {
    const surfaceElRef = useRef<HTMLDivElement>(null);
    const [ containerEl, setContainerEl ] = useState<HTMLDivElement | null>(null);
    const [ isFullscreen, isPageFullscreen, toggleFullscreen ] = useNoteFullscreen(containerEl, note?.noteId);
    const surfaceRef = useRef<InkSurface | undefined>(undefined);
    const pendingDocRef = useRef<InkDocument | undefined>(undefined);
    const noteIdRef = useRef(note?.noteId);
    noteIdRef.current = note?.noteId;
    /** The note whose strokes the surface shows. */
    const shownNoteIdRef = useRef<string | undefined>(undefined);
    const [ tool, setTool ] = useState<SurfaceTool>("pen");
    const [ color, setColor ] = useState(AUTO_COLOR);
    const [ size, setSize ] = useState(3);
    const [ state, setState ] = useState<InkSurfaceState>({ zoom: 1, canUndo: false, canRedo: false });
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ fingerDrawing, setFingerDrawing ] = useTriliumOptionBool("handwritingFingerDrawing");

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "handwriting",
        getData() {
            const surface = surfaceRef.current;
            return surface ? { content: surface.serialize() } : undefined;
        },
        onContentChange(content) {
            const doc = parseInkDocument(content);
            if (surfaceRef.current) {
                showDocument(surfaceRef.current, doc);
            } else {
                pendingDocRef.current = doc;
            }
        }
    });

    /**
     * Loads `doc`. A note opened anew shows the view it was left at in this session, else the one
     * it was saved at, else all its content; a note changed elsewhere keeps the view it has.
     */
    function showDocument(surface: InkSurface, doc: InkDocument) {
        const noteId = noteIdRef.current;
        const previous = shownNoteIdRef.current;
        if (previous && previous !== noteId) sessionViews.set(previous, surface.getCenterView());
        surface.load(doc);
        if (!previous || previous !== noteId) {
            shownNoteIdRef.current = noteId;
            surface.showView((noteId && sessionViews.get(noteId)) || doc.view || "content");
        }
    }

    useEffect(() => {
        if (!surfaceElRef.current) return;
        const surface = new InkSurface(surfaceElRef.current, {
            // As in canvas notes, each change postpones the save, so it runs once writing pauses.
            onChange: () => {
                spacedUpdate.resetUpdateTimer();
                spacedUpdate.scheduleUpdate();
            },
            onGestureStart: () => spacedUpdate.resetUpdateTimer(),
            onStateChange: setState
        });
        surfaceRef.current = surface;
        if (pendingDocRef.current) {
            showDocument(surface, pendingDocRef.current);
            pendingDocRef.current = undefined;
        }
        return () => {
            if (shownNoteIdRef.current) sessionViews.set(shownNoteIdRef.current, surface.getCenterView());
            shownNoteIdRef.current = undefined;
            surface.destroy();
            surfaceRef.current = undefined;
        };
    }, [ spacedUpdate ]);

    useEffect(() => {
        const surface = surfaceRef.current;
        if (!surface) return;
        surface.tool = tool;
        surface.color = color;
        surface.size = size;
        surface.readOnly = isReadOnly;
        surface.fingerDrawing = fingerDrawing;
    }, [ tool, color, size, isReadOnly, fingerDrawing ]);

    function cyclePaper() {
        const surface = surfaceRef.current;
        if (!surface) return;
        const next = (PAPER_STYLES.indexOf(surface.getPaper()) + 1) % PAPER_STYLES.length;
        surface.setPaper(PAPER_STYLES[next]);
    }

    return (
        <div
            ref={setContainerEl}
            className={clsx("handwriting-container", isPageFullscreen && "handwriting-page-fullscreen")}
        >
            <div
                ref={surfaceElRef}
                className="handwriting-surface"
                data-tool={isReadOnly ? "pan" : tool}
                style={{ cursor: isReadOnly ? undefined : getInkCursor(tool, size, state.zoom) }}
            />

            {!isReadOnly && (
                <OverlayControlGroup placement="top-center" className="handwriting-tools">
                    {TOOLS.map(({ tool: itemTool, icon, title }) => (
                        <OverlayControlButton
                            key={itemTool}
                            title={title()}
                            icon={icon}
                            active={tool === itemTool}
                            onClick={() => setTool(itemTool)}
                        />
                    ))}
                    {HAS_TOUCH && (
                        <OverlayControlButton
                            title={t("handwriting.finger_drawing")}
                            icon="bxs-hand-up"
                            active={fingerDrawing}
                            onClick={() => setFingerDrawing(!fingerDrawing)}
                        />
                    )}
                    <OverlayControlDropdown title={t("handwriting.pen_settings")} icon="bx-palette" panel>
                        <div className="handwriting-pen-settings">
                            <ColorPicker
                                currentValue={color === AUTO_COLOR ? null : color}
                                onChange={(newColor) => setColor(newColor ?? AUTO_COLOR)}
                            />
                            <Slider
                                title={t("handwriting.thickness")}
                                value={size}
                                min={1}
                                max={12}
                                step={0.5}
                                onChange={setSize}
                            />
                        </div>
                    </OverlayControlDropdown>
                    <OverlayControlButton
                        title={t("handwriting.change_paper")}
                        icon="bx-grid"
                        onClick={cyclePaper}
                    />
                    <OverlayControlButton
                        title={t("handwriting.undo")}
                        icon="bx-undo"
                        disabled={!state.canUndo}
                        onClick={() => surfaceRef.current?.undo()}
                    />
                    <OverlayControlButton
                        title={t("handwriting.redo")}
                        icon="bx-redo"
                        disabled={!state.canRedo}
                        onClick={() => surfaceRef.current?.redo()}
                    />
                </OverlayControlGroup>
            )}

            <OverlayControlGroup placement="bottom-end" className="handwriting-zoom">
                <ZoomControls
                    percent={Math.round(state.zoom * 100)}
                    onZoomIn={() => surfaceRef.current?.zoomBy(1.25)}
                    onZoomOut={() => surfaceRef.current?.zoomBy(0.8)}
                    onReset={() => surfaceRef.current?.resetZoom()}
                />
                <OverlayControlButton
                    title={t("handwriting.zoom_to_fit")}
                    icon="bx-target-lock"
                    onClick={() => surfaceRef.current?.showView("content")}
                />
                <OverlayFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
            </OverlayControlGroup>
        </div>
    );
}

/**
 * Shows the note fullscreen. On iOS and iPadOS, the note fills the page instead of the screen:
 * Safari closes an element's fullscreen on a downward drag, which panning makes all the time.
 * Escape or the button leaves either mode, and so does opening another note.
 */
/** Cursors browsers show reliably are at most 128 px wide; this leaves room for the outline. */
const MAX_CURSOR_DIAMETER = 120;
const MIN_CURSOR_DIAMETER = 4;

/**
 * Returns the cursor of the pen and the highlighter: a ring as wide on screen as the line they
 * draw at a pressure of one half, drawn black inside white to show on any background. Returns
 * `undefined` for the eraser, whose cursor is in the stylesheet.
 */
function getInkCursor(tool: SurfaceTool, size: number, zoom: number) {
    if (tool === "eraser") return undefined;
    const width = tool === "highlighter" ? size * HIGHLIGHTER_WIDTH_FACTOR : size;
    const diameter = Math.min(MAX_CURSOR_DIAMETER, Math.max(MIN_CURSOR_DIAMETER, width * zoom));
    const box = Math.ceil(diameter) + 4;
    const center = box / 2;
    const ring = (color: string, strokeWidth: number) =>
        `<circle cx='${center}' cy='${center}' r='${diameter / 2}' fill='none' stroke='${color}' stroke-width='${strokeWidth}'/>`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${box}' height='${box}'>${ring("white", 3)}${ring("black", 1)}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${center} ${center}, crosshair`;
}

function useNoteFullscreen(containerEl: HTMLElement | null, noteId: string | undefined): [ boolean, boolean, () => void ] {
    const [ isScreenFullscreen, toggleScreenFullscreen ] = useFullscreen(containerEl);
    const [ isPageFullscreen, setPageFullscreen ] = useState(false);

    useEffect(() => setPageFullscreen(false), [ noteId ]);
    useEffect(() => {
        if (!isPageFullscreen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setPageFullscreen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [ isPageFullscreen ]);
    useEffect(() => {
        if (!isPageFullscreen || !containerEl) return;
        return releaseFromAncestors(containerEl);
    }, [ isPageFullscreen, containerEl ]);

    if (!isIOS()) {
        return [ isScreenFullscreen, false, () => void toggleScreenFullscreen() ];
    }
    return [ isPageFullscreen, isPageFullscreen, () => setPageFullscreen(!isPageFullscreen) ];
}

/**
 * The styles that make an ancestor confine a fixed element, by clipping it, by acting as its
 * containing block or by keeping its `z-index` inside a stacking context, with the value that
 * does not. `#center-pane` isolates itself and the scrolling container of a note has a clip path.
 */
const CONFINING_STYLES: { property: string, neutral: string, confines(value: string, style: CSSStyleDeclaration): boolean }[] = [
    { property: "isolation", neutral: "auto", confines: (value) => value === "isolate" },
    { property: "clip-path", neutral: "none", confines: (value) => value !== "none" },
    { property: "mask-image", neutral: "none", confines: (value) => value !== "none" && value !== "" },
    { property: "transform", neutral: "none", confines: (value) => value !== "none" },
    { property: "translate", neutral: "none", confines: (value) => value !== "none" && value !== "" },
    { property: "scale", neutral: "none", confines: (value) => value !== "none" && value !== "" },
    { property: "filter", neutral: "none", confines: (value) => value !== "none" },
    { property: "backdrop-filter", neutral: "none", confines: (value) => value !== "none" && value !== "" },
    { property: "opacity", neutral: "1", confines: (value) => Number(value) < 1 },
    { property: "will-change", neutral: "auto", confines: (value) => /transform|filter|opacity|perspective|clip/.test(value) },
    { property: "contain", neutral: "none", confines: (value) => /layout|paint|strict|content/.test(value) },
    { property: "container-type", neutral: "normal", confines: (value) => value !== "normal" && value !== "" },
    { property: "z-index", neutral: "auto", confines: (value, style) => value !== "auto" && style.position !== "static" }
];

/**
 * Overrides the styles of the ancestors of `element` that would confine it, for it to cover the
 * page, and returns the function that puts them back.
 */
function releaseFromAncestors(element: HTMLElement) {
    const restores: (() => void)[] = [];
    for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const ancestor = node;
        const computed = getComputedStyle(ancestor);
        for (const { property, neutral, confines } of CONFINING_STYLES) {
            if (!confines(computed.getPropertyValue(property), computed)) continue;
            const value = ancestor.style.getPropertyValue(property);
            const priority = ancestor.style.getPropertyPriority(property);
            ancestor.style.setProperty(property, neutral, "important");
            restores.push(() => ancestor.style.setProperty(property, value, priority));
        }
    }
    return () => {
        for (const restore of restores) restore();
    };
}
