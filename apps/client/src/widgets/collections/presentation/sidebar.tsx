import "./sidebar.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import Icon from "../../react/Icon";
import ShadowDom from "../../react/ShadowDom";
import { createFitObserver } from "./fit";
import { PresentationModel, PresentationSlideBaseModel, SlideMove } from "./model";
import thumbnailStylesheet from "./sidebar_thumbnail.css?raw";
import { openSlideMenu, SlideMenuActions } from "./slide_menu";

type SlideContent = PresentationSlideBaseModel["content"];

/** The data type of a dragged thumbnail, which nothing outside the sidebar accepts. */
const SLIDE_DRAG_TYPE = "application/x-trilium-slide";
const ARROW_KEYS = [ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight" ];
/** How far a thumbnail is dragged to the side to make it a vertical or a top-level slide. */
const LEVEL_SHIFT_DISTANCE = 24;

interface SlideSidebarProps {
    presentation: PresentationModel;
    /** The presentation's stylesheets, with `:root` already replaced by `:host`. */
    stylesheets: string[];
    /** The content of each text slide whose editor closed, by note ID, shown over the model's. */
    closingContents: Record<string, SlideContent>;
    /** The note of the slide that Reveal.js shows. */
    activeNoteId: string | undefined;
    /** Moves to the slide of a clicked thumbnail. */
    onSelectSlide: (noteId: string) => void;
    /**
     * Returns the move of a slide dropped into the gap before the thumbnail at `gap`, made vertical or
     * top-level by `levelShift`, or nothing where it cannot go.
     */
    planSlideMove?: (noteId: string, gap: number, levelShift: -1 | 0 | 1) => SlideMove | undefined;
    /** Moves a dropped slide; left out when the slides cannot be moved, which leaves the thumbnails undraggable. */
    onMoveSlide?: (move: SlideMove) => void;
    /** What the context menu of a thumbnail offers beyond opening the note; empty in a read-only presentation. */
    slideMenuActions?: SlideMenuActions;
}

/** The thumbnail being dragged, and where it would go if dropped now. */
interface DragState {
    noteId: string;
    /** Where the drag started, to tell how far it went to the side. */
    startX: number;
    drop?: SlideMove;
}

/**
 * Lists the slides of a presentation as thumbnails, with the vertical slides of a slide indented under it.
 * Each thumbnail renders the slide's content in a shadow root of its own, styled by the presentation's
 * theme, at full slide size scaled down.
 */
export default function SlideSidebar({
    presentation, stylesheets, closingContents, activeNoteId, onSelectSlide, planSlideMove, onMoveSlide,
    slideMenuActions = {}
}: SlideSidebarProps) {
    const sheets = useMemo(() => buildStyleSheets([ ...stylesheets, thumbnailStylesheet ]), [ stylesheets ]);
    const fitObserver = useFitObserver();
    const listRef = useRef<HTMLOListElement>(null);
    // In the order of the thumbnails, vertical slides included.
    const noteIds = presentation.slides.flatMap(slide => [
        slide.noteId, ...slide.verticalSlides?.map(verticalSlide => verticalSlide.noteId) ?? []
    ]);
    const tabStopNoteId = activeNoteId && noteIds.includes(activeNoteId) ? activeNoteId : noteIds[0];
    const canDrag = !!planSlideMove && !!onMoveSlide;
    const [ drag, setDrag ] = useState<DragState>();
    const movedNoteIdRef = useRef<string | undefined>(undefined);
    const [ menuNoteId, setMenuNoteId ] = useState<string>();

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        list.querySelector(".slide-thumbnail.active")?.scrollIntoView({ block: "nearest" });
        // The focus follows the slide only once it is in the sidebar, so that it stays in the slides otherwise.
        if (list.contains(document.activeElement)) {
            list.querySelector<HTMLElement>(".slide-thumbnail-button[aria-current]")?.focus();
        }
    }, [ activeNoteId ]);

    useEffect(() => {
        const noteId = movedNoteIdRef.current;
        if (!noteId) return;
        movedNoteIdRef.current = undefined;
        listRef.current?.querySelector<HTMLElement>(`li[data-slide-id="${noteId}"] > .slide-thumbnail-button`)?.focus();
    }, [ presentation ]);

    function onKeyDown(e: KeyboardEvent) {
        const list = listRef.current;
        const button = e.target instanceof Element ? e.target.closest(".slide-thumbnail-button") : null;
        const buttons = [ ...list?.querySelectorAll(".slide-thumbnail-button") ?? [] ];
        const index = button ? buttons.indexOf(button) : -1;
        if (!list || index < 0) return;

        if (e.altKey && planSlideMove && onMoveSlide && ARROW_KEYS.includes(e.key)) {
            // Reveal.js takes Alt and the arrows to move without fragments.
            e.preventDefault();
            e.stopPropagation();
            const noteId = noteIds[index];
            const move = findKeyboardMove(
                (gap, levelShift) => planSlideMove(noteId, gap, levelShift),
                e.key, index, buttons.length, isRightToLeft(list)
            );
            if (move) {
                // The thumbnail goes into another place in the list, which takes the focus away from it.
                movedNoteIdRef.current = noteId;
                onMoveSlide(move);
            }
            return;
        }
        if (e.altKey || e.ctrlKey || e.metaKey) return;

        const nextIndex = getNextIndex(e.key, index, noteIds.length);
        if (nextIndex === undefined) return;
        // Reveal.js listens to the whole document, and would move by the same key too.
        e.preventDefault();
        e.stopPropagation();
        if (nextIndex !== index) onSelectSlide(noteIds[nextIndex]);
    }

    /**
     * Returns where the dragged slide goes: into the gap above the first thumbnail whose middle is below
     * the pointer, at the level that dragging to the side picks.
     */
    function findDrop(e: DragEvent) {
        if (!drag || !planSlideMove) return;
        const buttons = [ ...listRef.current?.querySelectorAll(".slide-thumbnail-button") ?? [] ];
        const gap = buttons.findIndex(button => {
            const { top, height } = button.getBoundingClientRect();
            return e.clientY < top + height / 2;
        });
        // Vertical slides are indented toward the end of the line, which is the left in right-to-left text.
        const dx = (e.clientX - drag.startX) * (listRef.current && isRightToLeft(listRef.current) ? -1 : 1);
        const levelShift = dx >= LEVEL_SHIFT_DISTANCE ? 1 : dx <= -LEVEL_SHIFT_DISTANCE ? -1 : 0;
        return planSlideMove(drag.noteId, gap < 0 ? buttons.length : gap, levelShift);
    }

    function onDragOver(e: DragEvent) {
        if (!drag) return;
        const drop = findDrop(e);
        if (drop) {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        }
        if (drop?.targetNoteId !== drag.drop?.targetNoteId || drop?.position !== drag.drop?.position) {
            setDrag({ ...drag, drop });
        }
    }

    function onDrop(e: DragEvent) {
        if (!drag) return;
        e.preventDefault();
        if (drag.drop) onMoveSlide?.(drag.drop);
        setDrag(undefined);
    }

    function onDragLeave(e: DragEvent) {
        const list = listRef.current;
        if (drag?.drop && list && !(e.relatedTarget instanceof Node && list.contains(e.relatedTarget))) {
            setDrag({ noteId: drag.noteId, startX: drag.startX });
        }
    }

    /** Opens the context menu of a thumbnail, with the moves that Alt and the arrows would make on it. */
    function onThumbnailContextMenu(e: MouseEvent, slide: PresentationSlideBaseModel, isVertical: boolean) {
        const list = listRef.current;
        const button = e.currentTarget;
        if (!list || !(button instanceof HTMLElement)) return;
        e.preventDefault();
        e.stopPropagation();

        const buttons = [ ...list.querySelectorAll(".slide-thumbnail-button") ];
        const index = buttons.indexOf(button);
        const isRtl = isRightToLeft(list);
        const plan = planSlideMove && onMoveSlide
            ? (gap: number, levelShift: -1 | 0 | 1) => planSlideMove(slide.noteId, gap, levelShift)
            : undefined;
        const moves = plan && {
            up: findKeyboardMove(plan, "ArrowUp", index, buttons.length, isRtl),
            down: findKeyboardMove(plan, "ArrowDown", index, buttons.length, isRtl),
            toVertical: plan(index, 1),
            toTopLevel: plan(index, -1)
        };
        // The menu gives the focus back to the thumbnail it came from, which a change of level replaces.
        const hadFocus = document.activeElement === button;

        setMenuNoteId(slide.noteId);
        openSlideMenu(e, button, { slide, isVertical, moves, isRtl }, slideMenuActions, (move) => {
            if (hadFocus) movedNoteIdRef.current = slide.noteId;
            onMoveSlide?.(move);
        }, () => setMenuNoteId(undefined));
    }

    function renderThumbnail(slide: PresentationSlideBaseModel, isVertical: boolean) {
        const closingContent = closingContents[slide.noteId];
        const isActive = slide.noteId === activeNoteId;
        return (
            <button
                type="button"
                className="slide-thumbnail-button"
                tabIndex={slide.noteId === tabStopNoteId ? 0 : -1}
                aria-label={froca.getNoteFromCache(slide.noteId)?.title}
                aria-current={isActive ? "true" : undefined}
                onClick={() => onSelectSlide(slide.noteId)}
                draggable={canDrag}
                onDragStart={canDrag ? (e) => {
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(SLIDE_DRAG_TYPE, slide.noteId);
                    }
                    setDrag({ noteId: slide.noteId, startX: e.clientX });
                } : undefined}
                onDragEnd={() => setDrag(undefined)}
                onContextMenu={(e) => onThumbnailContextMenu(e, slide, isVertical)}
            >
                <SlideThumbnail
                    slide={closingContent ? { ...slide, content: closingContent } : slide}
                    isActive={isActive}
                    sheets={sheets}
                    fitObserver={fitObserver}
                />
            </button>
        );
    }

    return (
        <ol
            ref={listRef}
            className="presentation-sidebar"
            onKeyDown={onKeyDown}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
        >
            {presentation.slides.map(slide => (
                <li key={slide.noteId} {...getItemProps(slide.noteId, drag, menuNoteId)}>
                    {renderThumbnail(slide, false)}
                    {slide.verticalSlides && (
                        <ol className="presentation-sidebar-vertical-slides">
                            {slide.verticalSlides.map(verticalSlide => (
                                <li
                                    key={verticalSlide.noteId}
                                    {...getItemProps(verticalSlide.noteId, drag, menuNoteId)}
                                >
                                    {renderThumbnail(verticalSlide, true)}
                                </li>
                            ))}
                        </ol>
                    )}
                </li>
            ))}
        </ol>
    );
}

/**
 * The note ID of a thumbnail's list item, and the classes that mark it as dragged, as where a drop goes
 * (above it, below it past its vertical slides, or below it as its first vertical slide), or as the
 * slide whose context menu is open.
 */
function getItemProps(noteId: string, drag: DragState | undefined, menuNoteId: string | undefined) {
    const drop = drag?.drop?.targetNoteId === noteId ? drag.drop.position : undefined;
    return {
        "data-slide-id": noteId,
        className: clsx({
            dragging: drag?.noteId === noteId,
            "drop-before": drop === "before",
            "drop-after": drop === "after",
            "drop-into": drop === "into",
            "menu-target": menuNoteId === noteId
        }) || undefined
    };
}

interface ThumbnailContentProps {
    slide: PresentationSlideBaseModel;
    sheets: CSSStyleSheet[];
    fitObserver: ResizeObserver | undefined;
}

interface SlideThumbnailProps extends ThumbnailContentProps {
    isActive: boolean;
}

function SlideThumbnail({ slide, isActive, sheets, fitObserver }: SlideThumbnailProps) {
    const className = clsx("slide-thumbnail", { active: isActive });

    // A web view or a collection is live content, which a thumbnail does not load a second time.
    if (slide.webViewSrc || slide.isCollection) {
        const icon = slide.webViewSrc ? "bx bx-globe" : froca.getNoteFromCache(slide.noteId)?.getIcon();
        return (
            <div className={clsx(className, "slide-thumbnail-placeholder")} data-note-id={slide.noteId}>
                <Icon icon={icon} />
            </div>
        );
    }

    return (
        <ShadowDom className={className} data-note-id={slide.noteId}>
            <ThumbnailContent slide={slide} sheets={sheets} fitObserver={fitObserver} />
        </ShadowDom>
    );
}

function ThumbnailContent({ slide, sheets, fitObserver }: ThumbnailContentProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // A layout effect, so the theme applies before the thumbnail paints.
    useLayoutEffect(() => {
        const root = viewportRef.current?.getRootNode();
        if (root instanceof ShadowRoot) root.adoptedStyleSheets = sheets;
    }, [ sheets ]);

    useEffect(() => {
        const content = contentRef.current;
        if (!fitObserver || !content) return;
        fitObserver.observe(content);
        return () => fitObserver.unobserve(content);
    }, [ fitObserver ]);

    const background = slide.backgroundGradient ?? slide.backgroundColor;
    return (
        <div
            ref={viewportRef}
            className="reveal-viewport"
            style={background ? { background } : undefined}
            inert
        >
            <div className="reveal">
                <div className="slides">
                    <section className="present">
                        <div ref={contentRef} className="slide-content" dangerouslySetInnerHTML={slide.content} />
                    </section>
                </div>
            </div>
        </div>
    );
}

/**
 * Returns the index of the thumbnail that `key` moves to from the one at `index`, or `undefined` for
 * a key the sidebar leaves alone. At either end, the arrow keys stay where they are.
 */
function getNextIndex(key: string, index: number, count: number) {
    switch (key) {
        case "ArrowUp": return Math.max(index - 1, 0);
        case "ArrowDown": return Math.min(index + 1, count - 1);
        case "Home": return 0;
        case "End": return count - 1;
        default: return undefined;
    }
}

/**
 * Returns the move of the slide at `index` for Alt and an arrow key: Up and Down take the nearest gap
 * above or below where the slide can go at its level, so that a top-level slide passes a whole stack;
 * the arrow toward the indent makes it a vertical slide where it stands, the other a top-level slide.
 */
function findKeyboardMove(
    plan: (gap: number, levelShift: -1 | 0 | 1) => SlideMove | undefined,
    key: string, index: number, count: number, isRtl: boolean
) {
    if (key === "ArrowUp") {
        for (let gap = index - 1; gap >= 0; gap--) {
            const move = plan(gap, 0);
            if (move) return move;
        }
    } else if (key === "ArrowDown") {
        for (let gap = index + 1; gap <= count; gap++) {
            const move = plan(gap, 0);
            if (move) return move;
        }
    } else {
        const isTowardIndent = (key === "ArrowRight") !== isRtl;
        return plan(index, isTowardIndent ? 1 : -1);
    }
}

function isRightToLeft(element: Element) {
    return getComputedStyle(element).direction === "rtl";
}

/** Creates the observer that zooms out thumbnails whose content is larger than the slide. */
function useFitObserver() {
    const [ fitObserver, setFitObserver ] = useState<ResizeObserver>();
    useEffect(() => {
        const observer = createFitObserver(() => {});
        setFitObserver(observer);
        return () => observer.disconnect();
    }, []);
    return fitObserver;
}

/** Parses each stylesheet once, so that every thumbnail adopts the same sheets. */
export function buildStyleSheets(stylesheets: string[]) {
    return stylesheets.map(css => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        return sheet;
    });
}
