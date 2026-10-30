import "./sidebar.css";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import Icon from "../../react/Icon";
import ShadowDom from "../../react/ShadowDom";
import { createFitObserver } from "./fit";
import { PresentationModel, PresentationSlideBaseModel } from "./model";
import thumbnailStylesheet from "./sidebar_thumbnail.css?raw";

type SlideContent = PresentationSlideBaseModel["content"];

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
}

/**
 * Lists the slides of a presentation as thumbnails, with the vertical slides of a slide indented under it.
 * Each thumbnail renders the slide's content in a shadow root of its own, styled by the presentation's
 * theme, at full slide size scaled down.
 */
export default function SlideSidebar({
    presentation, stylesheets, closingContents, activeNoteId, onSelectSlide
}: SlideSidebarProps) {
    const sheets = useMemo(() => buildStyleSheets([ ...stylesheets, thumbnailStylesheet ]), [ stylesheets ]);
    const fitObserver = useFitObserver();
    const listRef = useRef<HTMLOListElement>(null);
    // In the order of the thumbnails, vertical slides included.
    const noteIds = presentation.slides.flatMap(slide => [
        slide.noteId, ...slide.verticalSlides?.map(verticalSlide => verticalSlide.noteId) ?? []
    ]);
    const tabStopNoteId = activeNoteId && noteIds.includes(activeNoteId) ? activeNoteId : noteIds[0];

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        list.querySelector(".slide-thumbnail.active")?.scrollIntoView({ block: "nearest" });
        // The focus follows the slide only once it is in the sidebar, so that it stays in the slides otherwise.
        if (list.contains(document.activeElement)) {
            list.querySelector<HTMLElement>(".slide-thumbnail-button[aria-current]")?.focus();
        }
    }, [ activeNoteId ]);

    function onKeyDown(e: KeyboardEvent) {
        const button = e.target instanceof Element ? e.target.closest(".slide-thumbnail-button") : null;
        const buttons = [ ...listRef.current?.querySelectorAll(".slide-thumbnail-button") ?? [] ];
        const index = button ? buttons.indexOf(button) : -1;
        if (index < 0) return;

        const nextIndex = getNextIndex(e.key, index, noteIds.length);
        if (nextIndex === undefined) return;
        // Reveal.js listens to the whole document, and would move by the same key too.
        e.preventDefault();
        e.stopPropagation();
        if (nextIndex !== index) onSelectSlide(noteIds[nextIndex]);
    }

    function renderThumbnail(slide: PresentationSlideBaseModel) {
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
        <ol ref={listRef} className="presentation-sidebar" onKeyDown={onKeyDown}>
            {presentation.slides.map(slide => (
                <li key={slide.noteId}>
                    {renderThumbnail(slide)}
                    {slide.verticalSlides && (
                        <ol className="presentation-sidebar-vertical-slides">
                            {slide.verticalSlides.map(verticalSlide => (
                                <li key={verticalSlide.noteId}>{renderThumbnail(verticalSlide)}</li>
                            ))}
                        </ol>
                    )}
                </li>
            ))}
        </ol>
    );
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
