import "./sidebar.css";

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
}

/**
 * Lists the slides of a presentation as thumbnails, with the vertical slides of a slide indented under it.
 * Each thumbnail renders the slide's content in a shadow root of its own, styled by the presentation's
 * theme, at full slide size scaled down.
 */
export default function SlideSidebar({ presentation, stylesheets, closingContents }: SlideSidebarProps) {
    const sheets = useMemo(() => buildStyleSheets([ ...stylesheets, thumbnailStylesheet ]), [ stylesheets ]);
    const fitObserver = useFitObserver();

    function renderThumbnail(slide: PresentationSlideBaseModel) {
        const closingContent = closingContents[slide.noteId];
        return (
            <SlideThumbnail
                slide={closingContent ? { ...slide, content: closingContent } : slide}
                sheets={sheets}
                fitObserver={fitObserver}
            />
        );
    }

    return (
        <ol className="presentation-sidebar">
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

interface SlideThumbnailProps {
    slide: PresentationSlideBaseModel;
    sheets: CSSStyleSheet[];
    fitObserver: ResizeObserver | undefined;
}

function SlideThumbnail({ slide, sheets, fitObserver }: SlideThumbnailProps) {
    // A web view or a collection is live content, which a thumbnail does not load a second time.
    if (slide.webViewSrc || slide.isCollection) {
        const icon = slide.webViewSrc ? "bx bx-globe" : froca.getNoteFromCache(slide.noteId)?.getIcon();
        return (
            <div className="slide-thumbnail slide-thumbnail-placeholder" data-note-id={slide.noteId}>
                <Icon icon={icon} />
            </div>
        );
    }

    return (
        <ShadowDom className="slide-thumbnail" data-note-id={slide.noteId}>
            <ThumbnailContent slide={slide} sheets={sheets} fitObserver={fitObserver} />
        </ShadowDom>
    );
}

function ThumbnailContent({ slide, sheets, fitObserver }: SlideThumbnailProps) {
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
