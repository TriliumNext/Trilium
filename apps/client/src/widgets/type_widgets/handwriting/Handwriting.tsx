import "./Handwriting.css";

import clsx from "clsx";
import type { TargetedKeyboardEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isIOS } from "../../../services/utils";
import ColorPicker from "../../react/ColorPicker";
import type { DropdownHandle } from "../../react/Dropdown";
import { FormDropdownSubmenu, FormListItem } from "../../react/FormList";
import { useFullscreen } from "../../react/hooks/dom";
import { useEditorSpacedUpdate } from "../../react/hooks/editor";
import { useTriliumOptionBool } from "../../react/hooks/options";
import { useEffectiveReadOnly } from "../../react/hooks/note_context";
import OverlayControlGroup, {
    OverlayControlButton, OverlayControlDropdown, OverlayFullscreenButton, ZoomControls
} from "../../react/OverlayControlGroup";
import Slider from "../../react/Slider";
import { TypeWidgetProps } from "../type_widget";
import { AUTO_COLOR, type InkDocument, type InkTool, type InkView, PAPER_STYLES, parseInkDocument } from "./ink_document";
import InkSurface, { HIGHLIGHTER_WIDTH_FACTOR, type InkSurfaceState, type SurfaceTool } from "./ink_surface";

const TOOLS: { tool: SurfaceTool, icon: string, title: () => string, key: string }[] = [
    { tool: "pen", icon: "bx-pen", title: () => t("handwriting.pen"), key: "p" },
    { tool: "highlighter", icon: "bx-highlight", title: () => t("handwriting.highlighter"), key: "h" },
    { tool: "eraser", icon: "bx-eraser", title: () => t("handwriting.eraser"), key: "e" }
];

interface InkSettings {
    color: string;
    size: number;
}

const DEFAULT_INK_SETTINGS: Record<InkTool, InkSettings> = {
    pen: { color: AUTO_COLOR, size: 3 },
    highlighter: { color: "#facc15", size: 3 }
};
const MIN_SIZE = 1;
const MAX_SIZE = 12;
const SIZE_STEP = 0.5;

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
    const [ inkSettings, setInkSettings ] = useState(DEFAULT_INK_SETTINGS);
    const inkTool: InkTool | undefined = tool === "eraser" ? undefined : tool;
    const { color, size } = inkSettings[inkTool ?? "pen"];
    const settingsRef = useRef<DropdownHandle>(null);
    const [ state, setState ] = useState<InkSurfaceState>({ zoom: 1, paper: "ruled", canUndo: false, canRedo: false });
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

    function updateInk(changes: Partial<InkSettings>) {
        if (!inkTool) return;
        setInkSettings((current) => ({ ...current, [inkTool]: { ...current[inkTool], ...changes } }));
    }

    /** Picks `itemTool`, or opens its settings when it is already picked. */
    function pickTool(itemTool: SurfaceTool) {
        if (itemTool === tool && itemTool !== "eraser") {
            settingsRef.current?.show();
        } else {
            setTool(itemTool);
        }
    }

    function onKeyDown(e: TargetedKeyboardEvent<HTMLDivElement>) {
        if (isReadOnly) return;
        const key = e.key.toLowerCase();
        const modifier = e.ctrlKey || e.metaKey;
        let handled = true;
        if (modifier && !e.altKey && key === "z") {
            if (e.shiftKey) surfaceRef.current?.redo();
            else surfaceRef.current?.undo();
        } else if (modifier && !e.altKey && !e.shiftKey && key === "y") {
            surfaceRef.current?.redo();
        } else if (modifier || e.altKey) {
            handled = false;
        } else if (e.key === "[" || e.key === "]") {
            const step = e.key === "]" ? SIZE_STEP : -SIZE_STEP;
            updateInk({ size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, size + step)) });
        } else {
            const match = TOOLS.find((item) => item.key === key);
            if (match) setTool(match.tool);
            else handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    return (
        <div
            ref={setContainerEl}
            className={clsx("handwriting-container", isPageFullscreen && "handwriting-page-fullscreen")}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onPointerDown={() => containerEl?.focus({ preventScroll: true })}
        >
            <div
                ref={surfaceElRef}
                className="handwriting-surface"
                data-tool={isReadOnly ? "pan" : tool}
                style={{ cursor: isReadOnly ? undefined : getInkCursor(tool, size, state.zoom) }}
            />

            {!isReadOnly && (
                <div className="handwriting-toolbar">
                    <OverlayControlGroup className="handwriting-tools" titlePosition="bottom">
                        {TOOLS.map(({ tool: itemTool, icon, title, key }) => (
                            <OverlayControlButton
                                key={itemTool}
                                title={title()}
                                icon={icon}
                                shortcut={key.toUpperCase()}
                                active={tool === itemTool}
                                onClick={() => pickTool(itemTool)}
                            />
                        ))}
                        {inkTool && (
                            <OverlayControlDropdown
                                title={t("handwriting.pen_settings")}
                                face={<span className="handwriting-swatch" style={getSwatchStyle(color, size)} />}
                                dropdownRef={settingsRef}
                                panel
                            >
                                <div className="handwriting-pen-settings">
                                    <ColorPicker
                                        currentValue={color === AUTO_COLOR ? null : color}
                                        onChange={(newColor) => updateInk({ color: newColor ?? AUTO_COLOR })}
                                    />
                                    <Slider
                                        title={t("handwriting.thickness")}
                                        value={size}
                                        min={MIN_SIZE}
                                        max={MAX_SIZE}
                                        step={SIZE_STEP}
                                        onChange={(newSize) => updateInk({ size: newSize })}
                                    />
                                </div>
                            </OverlayControlDropdown>
                        )}
                    </OverlayControlGroup>

                    <OverlayControlGroup titlePosition="bottom">
                        <OverlayControlButton
                            title={t("handwriting.undo")}
                            icon="bx-undo"
                            shortcut="CommandOrControl+Z"
                            disabled={!state.canUndo}
                            onClick={() => surfaceRef.current?.undo()}
                        />
                        <OverlayControlButton
                            title={t("handwriting.redo")}
                            icon="bx-redo"
                            shortcut="CommandOrControl+Shift+Z"
                            disabled={!state.canRedo}
                            onClick={() => surfaceRef.current?.redo()}
                        />
                    </OverlayControlGroup>

                    <OverlayControlGroup titlePosition="bottom">
                        <OverlayControlDropdown title={t("common.more_actions")} icon="bx-dots-horizontal-rounded">
                            <FormDropdownSubmenu icon="bx bx-grid" title={t("handwriting.paper")}>
                                {PAPER_STYLES.map((paper) => (
                                    <FormListItem
                                        key={paper}
                                        checkable
                                        checked={state.paper === paper}
                                        onClick={() => surfaceRef.current?.setPaper(paper)}
                                    >
                                        {t(`handwriting.paper_${paper}`)}
                                    </FormListItem>
                                ))}
                            </FormDropdownSubmenu>
                            {HAS_TOUCH && (
                                <FormListItem
                                    icon="bx bxs-hand-up"
                                    checkable
                                    checked={fingerDrawing}
                                    onClick={() => setFingerDrawing(!fingerDrawing)}
                                >
                                    {t("handwriting.finger_drawing")}
                                </FormListItem>
                            )}
                        </OverlayControlDropdown>
                    </OverlayControlGroup>
                </div>
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

/** A dot of the ink's color, as thick as its line, for the button that opens its settings. */
function getSwatchStyle(color: string, size: number) {
    const diameter = Math.round(6 + size * 1.2);
    return {
        "--swatch-color": color === AUTO_COLOR ? "var(--main-text-color)" : color,
        "--swatch-size": `${diameter}px`
    };
}

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

/**
 * Shows the note fullscreen. On iOS and iPadOS, the note fills the page instead of the screen:
 * Safari closes an element's fullscreen on a downward drag, which panning makes all the time.
 * Escape or the button leaves either mode, and so does opening another note.
 */
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
