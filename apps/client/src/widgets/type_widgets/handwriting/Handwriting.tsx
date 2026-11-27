import "./Handwriting.css";

import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons/src/lib/notes.js";
import clsx from "clsx";
import type { CSSProperties, TargetedKeyboardEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { isIOS } from "../../../services/utils";
import { FormDropdownSubmenu, FormListItem } from "../../react/FormList";
import { useFullscreen } from "../../react/hooks/dom";
import { type SavedData, useEditorSpacedUpdate } from "../../react/hooks/editor";
import { useTriliumEvent } from "../../react/hooks/events";
import { useTriliumOptionBool, useTriliumOptionInt } from "../../react/hooks/options";
import { useEffectiveReadOnly } from "../../react/hooks/note_context";
import OverlayControlGroup, {
    OverlayControlButton, OverlayControlDropdown, OverlayFullscreenButton, ZoomControls
} from "../../react/OverlayControlGroup";
import Slider from "../../react/Slider";
import { TypeWidgetProps } from "../type_widget";
import {
    AUTO_COLOR, DEFAULT_PRESSURE_SENSITIVITY, INK_LAYOUTS, type InkDocument, type InkTool, type InkView,
    PAPER_STYLES, parseInkDocument
} from "./ink_document";
import InkSurface, { HIGHLIGHTER_WIDTH_FACTOR, type InkSurfaceState, type SurfaceTool } from "./ink_surface";

/** The tools of the toolbar, with the keys of drawing apps: H pans, and Shift+P is a second pen. */
const TOOLS: ToolbarTool[] = [
    { tool: "pen", icon: "bx-pen", title: () => t("handwriting.pen"), key: "p" },
    {
        tool: "highlighter", icon: "bx-highlight", title: () => t("handwriting.highlighter"),
        key: "p", shift: true
    },
    { tool: "eraser", icon: "bx-eraser", title: () => t("handwriting.eraser"), key: "e" },
    { tool: "pan", icon: "bx-move", title: () => t("handwriting.pan"), key: "h" }
];

interface ToolbarTool {
    tool: SurfaceTool;
    icon: string;
    title: () => string;
    /** The key that picks the tool, in lower case. */
    key: string;
    /** Whether the key picks the tool with Shift held. */
    shift?: boolean;
}

interface InkSettings {
    color: string;
    size: number;
}

/** The colors and the three thicknesses each tool offers. Its first color and middle thickness are its default. */
const INK_PRESETS: Record<InkTool, { colors: { color: string, name: string }[], sizes: number[] }> = {
    pen: {
        colors: [
            { color: AUTO_COLOR, name: "text" },
            { color: "#e64d4d", name: "red" },
            { color: "#4d99e6", name: "blue" },
            { color: "#4dae4d", name: "green" },
            { color: "#994de6", name: "purple" }
        ],
        sizes: [ 1.5, 3, 6 ]
    },
    highlighter: {
        colors: [
            { color: "#facc15", name: "yellow" },
            { color: "#99e64d", name: "green" },
            { color: "#e64db3", name: "pink" },
            { color: "#4de5e6", name: "cyan" },
            { color: "#e6994d", name: "orange" }
        ],
        sizes: [ 2, 4, 8 ]
    }
};
const SIZE_NAMES = [ "fine", "medium", "bold" ];

const DEFAULT_INK_SETTINGS: Record<InkTool, InkSettings> = {
    pen: { color: INK_PRESETS.pen.colors[0].color, size: INK_PRESETS.pen.sizes[1] },
    highlighter: { color: INK_PRESETS.highlighter.colors[0].color, size: INK_PRESETS.highlighter.sizes[1] }
};
const MIN_SIZE = 1;
const MAX_SIZE = 12;
const SIZE_STEP = 0.5;

/** Whether the device has a touch screen, the only one on which fingers can draw. */
const HAS_TOUCH = navigator.maxTouchPoints > 0;

/** The view of each note left in this session, which reopening the note shows again. */
const sessionViews = new Map<string, InkView>();

/** The version of the thumbnail that each save sends. */
const thumbnailVersions = new WeakMap<SavedData, number>();

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
    const inkTool: InkTool | undefined = tool === "eraser" || tool === "pan" ? undefined : tool;
    const { color, size } = inkSettings[inkTool ?? "pen"];
    const [ state, setState ] = useState<InkSurfaceState>({
        zoom: 1, paper: "ruled", layout: "pages", canUndo: false, canRedo: false, penErasing: false,
        page: 0, pageCount: 1
    });
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ fingerDrawing, setFingerDrawing ] = useTriliumOptionBool("handwritingFingerDrawing");
    const [ savedSensitivity, setSensitivity ] = useTriliumOptionInt("handwritingPressureSensitivity");
    const sensitivity = Number.isFinite(savedSensitivity) ? savedSensitivity : DEFAULT_PRESSURE_SENSITIVITY;
    /** Whether the space bar is held over the surface, which makes a pen or a mouse pan. */
    const [ spaceHeld, setSpaceHeld ] = useState(false);
    /**
     * The tool the pen uses now: the pan tool while the space bar is held, and the eraser while a
     * button of the pen erases.
     */
    let activeTool: SurfaceTool = tool;
    if (spaceHeld) activeTool = "pan";
    else if (state.penErasing && tool !== "pan") activeTool = "eraser";

    const spacedUpdate = useEditorSpacedUpdate({
        note,
        noteContext,
        noteType: "handwriting",
        async getData() {
            const surface = surfaceRef.current;
            if (!surface) return undefined;
            const content = surface.serialize();
            const thumbnail = await exportThumbnail(surface);
            if (!thumbnail) return { content };
            const data: SavedData = { content, attachments: [ getThumbnailRow(thumbnail.svg) ] };
            thumbnailVersions.set(data, thumbnail.version);
            return data;
        },
        dataSaved(data) {
            const version = thumbnailVersions.get(data);
            if (version !== undefined) surfaceRef.current?.markThumbnailSaved(version);
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
            if (note?.noteId === noteId && doc.strokes.length) void saveMissingThumbnail(surface, note);
        }
    }

    /** Saves the thumbnail of `shown`, a note saved before thumbnails or imported without one. */
    async function saveMissingThumbnail(surface: InkSurface, shown: FNote) {
        const attachments = await shown.getAttachments();
        if (attachments.some((attachment) => attachment.title === NOTE_TYPE_IMAGE_ATTACHMENTS.handwriting)) return;
        if (surface.readOnly || shownNoteIdRef.current !== shown.noteId) return;

        surface.invalidateThumbnail();
        const thumbnail = await exportThumbnail(surface);
        if (!thumbnail) return;
        try {
            await server.post(`notes/${shown.noteId}/attachments?matchBy=title`, getThumbnailRow(thumbnail.svg));
            surface.markThumbnailSaved(thumbnail.version);
        } catch (e) {
            console.error(`Could not save the thumbnail of the handwriting note '${shown.noteId}'`, e);
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
            onGesture: () => spacedUpdate.resetUpdateTimer(),
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
        surface.sensitivity = sensitivity;
        surface.fingerDrawing = fingerDrawing;
        surface.spacePanning = spaceHeld;
    }, [ tool, color, size, sensitivity, isReadOnly, fingerDrawing, spaceHeld ]);

    useTriliumEvent("themeChanged", () => surfaceRef.current?.refreshTheme());

    function updateInk(changes: Partial<InkSettings>) {
        if (!inkTool) return;
        setInkSettings((current) => ({ ...current, [inkTool]: { ...current[inkTool], ...changes } }));
    }

    function onKeyDown(e: TargetedKeyboardEvent<HTMLDivElement>) {
        // Only on the surface itself, so that the space bar still presses a focused toolbar button.
        if (e.key === " " && e.target === e.currentTarget && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setSpaceHeld(true);
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const pageStep = { PageUp: -1, PageDown: 1 }[e.key];
        if (pageStep && state.layout === "pages" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            surfaceRef.current?.goToPage(state.page + pageStep);
            e.preventDefault();
            e.stopPropagation();
            return;
        }
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
            const match = TOOLS.find((item) => item.key === key && !!item.shift === e.shiftKey);
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
            onKeyUp={(e) => {
                if (e.key === " ") setSpaceHeld(false);
            }}
            onBlur={() => setSpaceHeld(false)}
            onPointerDown={() => containerEl?.focus({ preventScroll: true })}
        >
            <div
                ref={surfaceElRef}
                className="handwriting-surface"
                data-tool={isReadOnly ? "pan" : activeTool}
                style={{ cursor: isReadOnly ? undefined : getInkCursor(activeTool, size, state.zoom) }}
            />

            {!isReadOnly && (
                <div className="handwriting-toolbar">
                    <OverlayControlGroup className="handwriting-tools" titlePosition="bottom">
                        {TOOLS.map(({ tool: itemTool, icon, title, key, shift }) => (
                            <OverlayControlButton
                                key={itemTool}
                                title={title()}
                                icon={icon}
                                shortcut={`${shift ? "Shift+" : ""}${key.toUpperCase()}`}
                                active={activeTool === itemTool}
                                onClick={() => setTool(itemTool)}
                            />
                        ))}
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
                            <FormDropdownSubmenu icon="bx bx-file-blank" title={t("handwriting.layout")}>
                                {INK_LAYOUTS.map((layout) => (
                                    <FormListItem
                                        key={layout}
                                        checkable
                                        checked={state.layout === layout}
                                        onClick={() => surfaceRef.current?.setLayout(layout)}
                                    >
                                        {t(`handwriting.layout_${layout}`)}
                                    </FormListItem>
                                ))}
                            </FormDropdownSubmenu>
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

            {!isReadOnly && inkTool && (
                <InkRail
                    tool={inkTool} color={color} size={size} onChange={updateInk}
                    sensitivity={sensitivity} onSensitivityChange={setSensitivity}
                />
            )}

            {state.layout === "pages" && (
                <OverlayControlGroup placement="bottom-start" className="handwriting-pages">
                    <OverlayControlButton
                        title={t("pagination.prev_page")}
                        icon="bx-chevron-up"
                        shortcut="PageUp"
                        disabled={state.page <= 0}
                        onClick={() => surfaceRef.current?.goToPage(state.page - 1)}
                    />
                    <span className="handwriting-page-counter">
                        {t("handwriting.page_counter", { current: state.page + 1, total: state.pageCount })}
                    </span>
                    <OverlayControlButton
                        title={t("pagination.next_page")}
                        icon="bx-chevron-down"
                        shortcut="PageDown"
                        disabled={state.page >= state.pageCount - 1}
                        onClick={() => surfaceRef.current?.goToPage(state.page + 1)}
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

interface InkRailProps {
    tool: InkTool;
    color: string;
    size: number;
    onChange(changes: Partial<InkSettings>): void;
    sensitivity: number;
    onSensitivityChange(sensitivity: number): void;
}

/**
 * The color and the thickness of the pen or the highlighter, on a rail down the side of the note:
 * steps and the value of the thickness, its three presets, the pressure sensitivity of the pen,
 * then the colors.
 */
function InkRail({ tool, color, size, onChange, sensitivity, onSensitivityChange }: InkRailProps) {
    const customInputRef = useRef<HTMLInputElement>(null);
    const presets = INK_PRESETS[tool];
    const isCustomColor = !presets.colors.some((preset) => preset.color === color);
    const setSize = (newSize: number) => onChange({ size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, newSize)) });

    return (
        <div className="handwriting-rail">
            <OverlayControlGroup vertical titlePosition="right">
                <OverlayControlButton
                    title={t("handwriting.thicker")}
                    icon="bx-plus"
                    shortcut="]"
                    disabled={size >= MAX_SIZE}
                    onClick={() => setSize(size + SIZE_STEP)}
                />
                <OverlayControlButton
                    title={t("handwriting.reset_thickness")}
                    text={Number.isInteger(size) ? String(size) : size.toFixed(1)}
                    onClick={() => setSize(presets.sizes[1])}
                />
                <OverlayControlButton
                    title={t("handwriting.thinner")}
                    icon="bx-minus"
                    shortcut="["
                    disabled={size <= MIN_SIZE}
                    onClick={() => setSize(size - SIZE_STEP)}
                />
            </OverlayControlGroup>

            <OverlayControlGroup vertical titlePosition="right">
                {presets.sizes.map((presetSize, index) => (
                    <OverlayControlButton
                        key={presetSize}
                        title={t(`handwriting.size_${SIZE_NAMES[index]}`)}
                        text={<span className="handwriting-dot" style={dotStyle(4 + index * 5)} />}
                        active={size === presetSize}
                        onClick={() => setSize(presetSize)}
                    />
                ))}
            </OverlayControlGroup>

            {tool === "pen" && (
                <OverlayControlGroup vertical titlePosition="right">
                    <OverlayControlDropdown panel title={t("handwriting.pressure_sensitivity")} icon="bx-tachometer">
                        <div className="handwriting-pressure">
                            <div className="handwriting-pressure-value">
                                {t("handwriting.pressure_sensitivity_value", { value: sensitivity })}
                            </div>
                            <Slider
                                min={0} max={100} step={5}
                                value={sensitivity}
                                title={t("handwriting.pressure_sensitivity")}
                                onChange={onSensitivityChange}
                            />
                            <p className="handwriting-pressure-hint">{t("handwriting.pressure_sensitivity_hint")}</p>
                        </div>
                    </OverlayControlDropdown>
                </OverlayControlGroup>
            )}

            <OverlayControlGroup vertical titlePosition="right">
                {presets.colors.map((preset) => (
                    <OverlayControlButton
                        key={preset.color}
                        title={t(`handwriting.color_${preset.name}`)}
                        text={<span className="handwriting-swatch" style={swatchStyle(preset.color)} />}
                        active={color === preset.color}
                        onClick={() => onChange({ color: preset.color })}
                    />
                ))}
                <OverlayControlButton
                    title={t("handwriting.color_custom")}
                    text={<span className="handwriting-swatch handwriting-swatch-custom" style={isCustomColor ? swatchStyle(color) : undefined} />}
                    active={isCustomColor}
                    onClick={() => customInputRef.current?.click()}
                />
            </OverlayControlGroup>

            {/* The browser's own color picker, which the custom color button opens. */}
            <input
                ref={customInputRef}
                type="color"
                className="handwriting-custom-color"
                value={isCustomColor && color.startsWith("#") ? color : "#000000"}
                onChange={(e) => onChange({ color: e.currentTarget.value })}
                tabIndex={-1}
                aria-hidden="true"
            />
        </div>
    );
}

function swatchStyle(color: string): CSSProperties {
    return { "--swatch-color": color === AUTO_COLOR ? "var(--main-text-color)" : color } as CSSProperties;
}

function dotStyle(diameter: number): CSSProperties {
    return { "--dot-size": `${diameter}px` } as CSSProperties;
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
    if (tool === "eraser" || tool === "pan") return undefined;
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
        const restoreAncestors = releaseFromAncestors(containerEl);
        const restoreEditables = disableEditablesOutside(containerEl);
        return () => {
            restoreAncestors();
            restoreEditables();
        };
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

/** The elements of the page that take typed text, and so Scribble's handwriting. */
const EDITABLE_SELECTOR = "input:not([type=hidden]), textarea, [contenteditable]:not([contenteditable=false])";

/**
 * Makes the text fields outside `element` inert, and returns the function that puts them back.
 * iPadOS Scribble writes Apple Pencil strokes into the text field under them even when the
 * element covers it, such as the note title under the toolbar.
 */
function disableEditablesOutside(element: HTMLElement) {
    const disabled: HTMLElement[] = [];
    for (const editable of document.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR)) {
        if (element.contains(editable) || editable.inert) continue;
        editable.inert = true;
        disabled.push(editable);
    }
    return () => {
        for (const editable of disabled) editable.inert = false;
    };
}

/** The thumbnail of `surface`, or `undefined` when the saved one is current or it cannot be drawn. */
async function exportThumbnail(surface: InkSurface) {
    try {
        return await surface.exportThumbnail();
    } catch (e) {
        console.error("Could not draw the thumbnail of a handwriting note", e);
        return undefined;
    }
}

function getThumbnailRow(svg: string) {
    return { role: "image", mime: "image/svg+xml", title: NOTE_TYPE_IMAGE_ATTACHMENTS.handwriting, content: svg, position: 0 };
}
