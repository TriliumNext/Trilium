import { CaptureUpdateAction, getMatchedLines, getSceneVersion } from "@excalidraw/excalidraw";
import type { Action } from "@excalidraw/excalidraw/actions/types";
import type {
    ExcalidrawElement, ExcalidrawTextElement
} from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import clsx from "clsx";
import type { RefObject } from "preact";

import { scrollRectIntoView } from "../../../services/highlight_matches";
import { escapeRegExp } from "../../../services/utils";
import type { FindOptions, FindTarget } from "../../merged_find";
import { DEFAULT_SIDEBAR, SEARCH_TAB } from "./CanvasEmbedTools";
import { applyDrawingView, type DrawingView, getBoundedView, isSameView } from "./drawing_view";

/** The colors of Excalidraw's search matches in each theme. */
export const MATCH_COLORS = {
    light: { current: "rgba(255, 124, 0, 0.4)", other: "rgba(255, 226, 0, 0.4)" },
    dark: { current: "rgba(229, 82, 0, 0.4)", other: "rgba(99, 52, 0, 0.4)" }
} as const satisfies Record<AppState["theme"], { current: string; other: string }>;

/** A match closer than this to an edge of the drawing, in pixels, counts as out of view. */
const VIEW_MARGIN_PX = 8;

/** Marks the root of a drawing while Excalidraw draws matches of "Search in note". */
const FIND_MATCHES_ATTRIBUTE = "data-find-matches";

/** A rectangle of a match on one line, relative to the top left of its text element. */
type MatchedLine = AppState["searchMatches"][number]["matchedLines"][number];

/** A match of "Search in note" in a text element of a drawing. */
export interface DrawingMatch {
    element: ExcalidrawTextElement;
    /** One rectangle for each line that the match covers. */
    lines: MatchedLine[];
}

/** What shows the matches of a drawing: Excalidraw, or the picture of the drawing. */
export interface DrawingSurface {
    getElements(): readonly ExcalidrawElement[];
    /** The view of the drawing, or `null` before the drawing shows. */
    getView(): DrawingView | null;
    setView(view: DrawingView): void;
    /** Draws `matches`, with the one at index `current` as the current match. */
    showMatches(matches: DrawingMatch[], current: number | null): void;
    /** Selects the shape of `match` and focuses the drawing. Returns whether it focused it. */
    select?(match: DrawingMatch): boolean;
}

/**
 * Searches the text of a canvas drawing for "Search in note". The drawing moves only to show a
 * current match that is out of view, and moves back to its view once the search moves on, unless
 * the user moved it since.
 */
export class DrawingFindTarget implements FindTarget {

    private surface: DrawingSurface | null = null;
    private regExp: RegExp | null = null;
    private matches: DrawingMatch[] = [];
    private current: number | null = null;
    /** The scene version of the shapes that `matches` were found in. */
    private version = 0;
    /** The view before the search moved the drawing. */
    private savedView: DrawingView | null = null;
    /** The view that the search moved the drawing to last. */
    private searchView: DrawingView | null = null;
    private onContentChange: (() => void) | null = null;

    /** Searches the drawing in `rootRef`, the box that shows it. */
    constructor(private readonly rootRef: RefObject<HTMLElement | null>) {}

    /** Whether a search is in progress. */
    get isSearching() {
        return this.regExp !== null;
    }

    /** Shows the matches on `surface`, until the returned function is called. */
    attach(surface: DrawingSurface) {
        this.surface?.showMatches([], null);
        this.surface = surface;
        this.searchAgain();
        return () => {
            if (this.surface !== surface) return;
            this.surface = null;
            this.matches = [];
            this.current = null;
            if (this.regExp) this.onContentChange?.();
        };
    }

    /** Searches the shapes again if they changed since the last search. */
    update() {
        if (!this.regExp || !this.surface) return;
        if (getSceneVersion(this.surface.getElements()) !== this.version) {
            this.searchAgain();
        }
    }

    async find(term: string, { matchCase, wholeWord }: FindOptions) {
        const boundary = wholeWord ? "\\b" : "";
        this.regExp = term
            ? new RegExp(boundary + escapeRegExp(term) + boundary, matchCase ? "g" : "gi")
            : null;
        this.search();
        return this.matches.length;
    }

    highlight(index: number | null) {
        const match = index === null ? undefined : this.matches[index];
        this.current = match ? index : null;
        this.surface?.showMatches(this.matches, this.current);
        if (match) {
            this.show(match, true);
        } else {
            this.restoreView();
        }
    }

    getFirstMatchBelow(top: number) {
        const root = this.rootRef.current;
        if (!root) return null;

        const box = root.getBoundingClientRect();
        const view = this.surface?.getView();
        const index = this.matches.findIndex((match) => {
            // A match out of view counts as at the nearest edge of the drawing.
            const matchTop = view ? getMatchRect(match, view).top : 0;
            return box.top + Math.min(Math.max(matchTop, 0), box.height) >= top;
        });
        return index >= 0 ? index : null;
    }

    canReplace() {
        return false;
    }

    async replace() {
        return this.matches.length;
    }

    async replaceAll() {
        return this.matches.length;
    }

    close(index: number | null) {
        const match = index === null ? undefined : this.matches[index];
        this.regExp = null;
        this.matches = [];
        this.current = null;
        this.surface?.showMatches([], null);
        if (!match) {
            this.restoreView();
            return false;
        }

        // The search ends on this match, so the drawing keeps showing it.
        this.savedView = null;
        this.searchView = null;
        this.show(match, false);
        return this.surface?.select?.(match) ?? false;
    }

    watchContent(callback: () => void) {
        this.onContentChange = callback;
        return () => {
            if (this.onContentChange === callback) this.onContentChange = null;
        };
    }

    private search() {
        const elements = this.surface?.getElements() ?? [];
        this.version = getSceneVersion(elements);
        this.matches = this.regExp ? findDrawingMatches(elements, this.regExp) : [];
        this.current = null;
        this.surface?.showMatches(this.matches, null);
    }

    /** Searches again for the term of the search in progress, whose results are then stale. */
    private searchAgain() {
        if (!this.regExp) return;
        this.search();
        this.onContentChange?.();
    }

    /**
     * Scrolls the note to `match`, and moves the drawing first if `match` is out of its view.
     * `restoreView()` undoes an `isTemporary` move.
     */
    private show(match: DrawingMatch, isTemporary: boolean) {
        const root = this.rootRef.current;
        const surface = this.surface;
        const view = surface?.getView();
        if (!root || !surface || !view) return;

        const { width, height } = root.getBoundingClientRect();
        const moved = getMovedView(match, view, width, height, surface.getElements());
        if (moved) {
            if (isTemporary) {
                // A view that the user moved since the last move is the one to return to.
                if (!this.searchView || !isSameView(view, this.searchView)) {
                    this.savedView = view;
                }
                this.searchView = moved;
            }
            surface.setView(moved);
        }

        const rect = getMatchRect(match, moved ?? view);
        scrollRectIntoView(root, () => {
            const box = root.getBoundingClientRect();
            return {
                left: box.left + rect.left,
                top: box.top + rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top
            };
        });
    }

    /** Shows the view from before the search, unless the user moved the drawing since. */
    private restoreView() {
        const view = this.surface?.getView();
        if (this.savedView && this.searchView && view && isSameView(view, this.searchView)) {
            this.surface?.setView(this.savedView);
        }
        this.savedView = null;
        this.searchView = null;
    }

}

/**
 * Shows the matches of `target` in Excalidraw, and searches again when the shapes change, until the
 * returned function is called. Excalidraw no longer opens its own search on Ctrl+F, which reaches
 * "Search in note" instead.
 */
export function attachExcalidraw(
    target: DrawingFindTarget,
    api: ExcalidrawImperativeAPI,
    root: HTMLElement | null
) {
    api.registerAction(SEARCH_MENU_ACTION);
    const detach = target.attach({
        getElements: () => api.getSceneElements(),
        getView: () => {
            const { zoom, scrollX, scrollY } = api.getAppState();
            return { zoom, scrollX, scrollY };
        },
        setView: (view) => applyDrawingView(api, view),
        showMatches: (matches, current) => {
            // `CanvasDrawing.css` shows the canvas of the matches while the focus is elsewhere.
            root?.toggleAttribute(FIND_MATCHES_ATTRIBUTE, matches.length > 0);
            api.updateScene({
                appState: {
                    searchMatches: matches.map(({ element, lines }, index) => ({
                        id: element.id,
                        focus: index === current,
                        matchedLines: lines
                    }))
                },
                captureUpdate: CaptureUpdateAction.NEVER
            });
        },
        select: ({ element }) => {
            // Excalidraw selects the shape around a label rather than the label.
            api.updateScene({
                appState: { selectedElementIds: { [element.containerId ?? element.id]: true } },
                captureUpdate: CaptureUpdateAction.NEVER
            });
            const container = root?.querySelector<HTMLElement>(".excalidraw");
            container?.focus();
            return !!container && container.contains(document.activeElement);
        }
    });
    const stopListening = api.onChange(() => target.update());
    return () => {
        stopListening();
        detach();
        root?.removeAttribute(FIND_MATCHES_ATTRIBUTE);
    };
}

interface DrawingMatchesProps {
    matches: DrawingMatch[];
    current: number | null;
    theme: AppState["theme"];
    /** The group of the matches, which `getSceneTransform()` places. */
    layerRef: RefObject<SVGGElement | null>;
}

/** The matches of "Search in note" over the picture of a drawing, as Excalidraw draws them. */
export function DrawingMatches({ matches, current, theme, layerRef }: DrawingMatchesProps) {
    const colors = MATCH_COLORS[theme];

    return (
        <svg className={clsx("canvas-drawing-find", theme === "dark" && "theme-dark")} aria-hidden>
            <g ref={layerRef}>
                {matches.map(({ element, lines }, index) => (
                    <g
                        key={index}
                        fill={index === current ? colors.current : colors.other}
                        transform={element.angle ? getRotation(element) : undefined}
                    >
                        {lines.map((line, lineIndex) => (
                            <rect
                                key={lineIndex}
                                x={element.x + line.offsetX}
                                y={element.y + line.offsetY}
                                width={line.width}
                                height={line.height}
                            />
                        ))}
                    </g>
                ))}
            </g>
        </svg>
    );
}

/** The SVG transform that draws scene coordinates where `view` shows them. */
export function getSceneTransform({ zoom, scrollX, scrollY }: DrawingView) {
    return `scale(${zoom.value}) translate(${scrollX} ${scrollY})`;
}

/**
 * Excalidraw's `searchMenu` action without its keystroke, so that Ctrl+F reaches
 * `useFindShortcut()`. The menus open Excalidraw's search themselves.
 */
const SEARCH_MENU_ACTION: Action = {
    name: "searchMenu",
    label: "search.title",
    viewMode: true,
    trackEvent: false,
    perform: (_elements, appState) => ({
        appState: {
            ...appState,
            openSidebar: { name: DEFAULT_SIDEBAR, tab: SEARCH_TAB },
            openDialog: null
        },
        captureUpdate: CaptureUpdateAction.EVENTUALLY
    })
};

/** The matches of `regExp`, a global expression, in the text of `elements`, from top to bottom. */
function findDrawingMatches(elements: readonly ExcalidrawElement[], regExp: RegExp) {
    const texts = elements
        .filter((element): element is ExcalidrawTextElement =>
            element.type === "text" && !element.isDeleted)
        .sort((a, b) => a.y - b.y || a.x - b.x);

    const matches: DrawingMatch[] = [];
    for (const element of texts) {
        for (const match of element.originalText.matchAll(regExp)) {
            const lines = getMatchedLines(element, match[0], match.index);
            if (lines.length) {
                matches.push({ element, lines });
            }
        }
    }
    return matches;
}

/**
 * The view that shows `match` in a drawing `width` by `height`: `view` centered on the match on
 * each axis where the match is out of view, within the bounds of an image canvas. `null` when
 * `view` shows the match.
 */
function getMovedView(
    match: DrawingMatch,
    view: DrawingView,
    width: number,
    height: number,
    elements: readonly ExcalidrawElement[]
): DrawingView | null {
    if (!width || !height) return null;

    const rect = getMatchRect(match, view);
    const shiftX = getShift(rect.left, rect.right, width);
    const shiftY = getShift(rect.top, rect.bottom, height);
    if (!shiftX && !shiftY) return null;

    const zoom = view.zoom.value;
    const moved = {
        zoom: view.zoom,
        scrollX: view.scrollX + shiftX / zoom,
        scrollY: view.scrollY + shiftY / zoom
    };
    return getBoundedView(elements, { ...moved, width, height } as AppState) ?? moved;
}

/**
 * The shift, in pixels, that centers the span from `start` to `end` in a size of `size`, or 0
 * while the span is inside it. A span longer than the size moves to its start.
 */
function getShift(start: number, end: number, size: number) {
    if (start >= VIEW_MARGIN_PX && end <= size - VIEW_MARGIN_PX) return 0;
    if (end - start > size - 2 * VIEW_MARGIN_PX) return VIEW_MARGIN_PX - start;
    return (size - start - end) / 2;
}

/** The bounds of `match` in pixels from the top left of a drawing at `view`. */
function getMatchRect({ element, lines }: DrawingMatch, view: DrawingView) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const line of lines) {
        const left = element.x + line.offsetX - centerX;
        const top = element.y + line.offsetY - centerY;
        for (const [ x, y ] of [
            [ left, top ], [ left + line.width, top ],
            [ left, top + line.height ], [ left + line.width, top + line.height ]
        ]) {
            xs.push(centerX + x * cos - y * sin);
            ys.push(centerY + x * sin + y * cos);
        }
    }

    const zoom = view.zoom.value;
    return {
        left: (Math.min(...xs) + view.scrollX) * zoom,
        top: (Math.min(...ys) + view.scrollY) * zoom,
        right: (Math.max(...xs) + view.scrollX) * zoom,
        bottom: (Math.max(...ys) + view.scrollY) * zoom
    };
}

/** The rotation of `element` around its center, as an SVG transform. */
function getRotation(element: ExcalidrawElement) {
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    return `rotate(${element.angle * 180 / Math.PI} ${centerX} ${centerY})`;
}
