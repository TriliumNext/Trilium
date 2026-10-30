import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import Reveal, { RevealApi } from "reveal.js";

import froca from "../../../services/froca";
import utils from "../../../services/utils";
import { DesktopWebView } from "../../type_widgets/WebView";
import { SlideContent } from "./closing_slides";
import { createFitObserver } from "./fit";
import { canEditSlideInPlace, PresentationModel, PresentationSlideBaseModel } from "./model";
import {
    followSlideLinks, getNoteIdFromSlide, goToSlide, isPressingButton, isTypingIn, keepKeyboardInPresentation,
    keepSlideShown
} from "./reveal";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const isElectron = utils.isElectron();
const EmbeddedNoteList = lazy(() => import("../NoteList").then(({ EmbeddedNoteList }) => ({ default: EmbeddedNoteList })));

interface PresentationProps {
    presentation: PresentationModel;
    setApi: (api: RevealApi | undefined) => void;
    ntxId: string | null | undefined;
    /** The note of the slide being edited in place. */
    editedNoteId: string | undefined;
    /** Whether the editor of the edited slide holds its content. */
    isEditorReady: boolean;
    /** The content of each text slide whose editor closed, by note ID, shown over the model's. */
    closingContents: Record<string, SlideContent>;
    /** Starts editing a text, canvas or collection slide in place; left out when the presentation cannot be edited. */
    onEditSlide: ((noteId: string) => void) | undefined;
    /** Receives the element that the editor of the edited slide goes into. */
    onEditorHost: (element: HTMLElement | null) => void;
    /** The note of a slide just added, to go to once Reveal.js has it. */
    pendingNoteId: string | undefined;
    /** Called once the presentation shows the slide of `pendingNoteId`. */
    onPendingSlideShown: (noteId: string) => void;
    /** Shows the presentation in full-screen, on F; left out where it cannot be. */
    onStartPresentation: (() => void) | undefined;
}

export function Presentation({
    presentation, setApi, ntxId, editedNoteId, isEditorReady, closingContents, onEditSlide,
    onEditorHost, pendingNoteId, onPendingSlideShown, onStartPresentation
}: PresentationProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [revealApi, setRevealApi] = useState<RevealApi>();
    const fitObserverRef = useRef<ResizeObserver>(null);
    const onStartPresentationRef = useRef(onStartPresentation);
    onStartPresentationRef.current = onStartPresentation;

    useEffect(() => {
        if (!containerRef.current) return;

        const api = new Reveal(containerRef.current, {
            transition: "slide",
            embedded: true,
            // `PresentationControls` navigates instead, outside the slide.
            controls: false,
            progress: false,
            // Must match the aspect ratio of `.reveal` in slidejs.css.
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            minScale: 0,
            maxScale: Infinity,
            pdfMaxPagesPerSlide: 1,
            // Reveal.js's own F puts its viewport in full-screen, which in the shadow root is not an
            // element, so F does what the "Start presentation" button does instead.
            keyboard: {
                70: () => onStartPresentationRef.current?.()
            },
            keyboardCondition(event) {
                return !isTypingIn(event) && !isPressingButton(event);
            },
        });
        const container = containerRef.current;
        const fitObserver = createFitObserver(() => {
            if (api.isReady()) api.layout();
        });
        fitObserverRef.current = fitObserver;

        api.initialize().then(() => {
            setRevealApi(api);
            setApi(api);
        });

        // Reveal.js listens only to window resizes, not to the note pane changing size.
        const resizeObserver = new ResizeObserver(() => {
            if (api.isReady()) api.layout();
        });
        resizeObserver.observe(container);
        const releaseKeyboard = keepKeyboardInPresentation(container);
        const stopFollowingLinks = followSlideLinks(container, api);

        return () => {
            stopFollowingLinks();
            releaseKeyboard();
            fitObserver.disconnect();
            fitObserverRef.current = null;
            resizeObserver.disconnect();
            api.destroy();
            setRevealApi(undefined);
            setApi(undefined);
        };
    }, []);

    useEffect(() => {
        const fitObserver = fitObserverRef.current;
        if (!revealApi || !containerRef.current || !fitObserver) return;
        const currentNoteId = getNoteIdFromSlide(revealApi.getCurrentSlide());
        revealApi.sync();
        if (currentNoteId) keepSlideShown(revealApi, currentNoteId);

        fitObserver.disconnect();
        for (const content of containerRef.current.querySelectorAll(".slide-content")) {
            fitObserver.observe(content);
        }
    }, [ presentation, revealApi, editedNoteId ]);

    // After the effect above, so that Reveal.js has synced the new slide.
    useEffect(() => {
        if (!revealApi || !pendingNoteId) return;
        if (!containerRef.current?.querySelector(`#slide-${pendingNoteId}`)) return;
        goToSlide(revealApi, pendingNoteId);
        onPendingSlideShown(pendingNoteId);
    }, [ presentation, revealApi, pendingNoteId ]);

    function renderSlide(slide: PresentationSlideBaseModel) {
        const isEdited = slide.noteId === editedNoteId;
        const canEdit = onEditSlide && !isEdited && canEditSlideInPlace(slide);
        const closingContent = closingContents[slide.noteId];
        return (
            <Slide
                key={slide.noteId}
                slide={closingContent ? { ...slide, content: closingContent } : slide}
                ntxId={ntxId}
                // A collection slide is edited in its own view, and a canvas one by `SlideCanvasEditor`.
                editorHostRef={isEdited && slide.type === "text" ? onEditorHost : undefined}
                isCanvasEdited={isEdited && slide.type === "canvas"}
                isEditorReady={isEditorReady}
                onEdit={canEdit ? () => {
                    if (!revealApi?.isOverview() && !document.fullscreenElement) onEditSlide(slide.noteId);
                } : undefined}
            />
        );
    }

    return (
        <div ref={containerRef} className="reveal">
            <div className="slides">
                {presentation.slides?.map(slide => {
                    if (!slide.verticalSlides) {
                        return renderSlide(slide);
                    }
                    return (
                        <section key={`stack-${slide.noteId}`}>
                            {renderSlide(slide)}
                            {slide.verticalSlides.map(renderSlide)}
                        </section>
                    );

                })}
            </div>
        </div>
    );

}

interface SlideProps {
    slide: PresentationSlideBaseModel;
    ntxId: string | null | undefined;
    /** Set while the slide is edited in place, to receive the element that the editor goes into. */
    editorHostRef?: (element: HTMLElement | null) => void;
    /** Whether the editor of the slide holds its content, so that it replaces the rendered content. */
    isEditorReady?: boolean;
    /** Whether the canvas of the slide is edited in place, by the editor that its `<slot>` shows. */
    isCanvasEdited?: boolean;
    /** Starts editing the slide in place, on a double-click. */
    onEdit?: () => void;
}

export function Slide({ slide, ntxId, editorHostRef, isEditorReady, isCanvasEdited, onEdit }: SlideProps) {
    // On desktop a web view goes in an Electron `<webview>`, whose own session keeps the page away
    // from the app; elsewhere Reveal.js frames it in the slide's background.
    const desktopWebViewSrc = isElectron ? slide.webViewSrc : undefined;
    const backgroundIframe = isElectron ? undefined : slide.webViewSrc;

    function renderContent() {
        if (desktopWebViewSrc) return <DesktopWebView src={desktopWebViewSrc} ntxId={ntxId} />;
        if (slide.isCollection) return <slot name={getCollectionSlotName(slide.noteId)} />;
        if (isCanvasEdited) return <slot name={getCanvasEditorSlotName(slide.noteId)} />;
        // The rendered content stays, with its zoom, until the editor that loads hidden beside it
        // holds the slide; then one render swaps them. The keys keep the two elements apart.
        return [
            (!editorHostRef || !isEditorReady) &&
                <div key="content" className="slide-content" dangerouslySetInnerHTML={slide.content} />,
            editorHostRef && <div
                key="editor"
                className={`slide-content slide-editor ${isEditorReady ? "" : "slide-editor-pending"}`}
                ref={editorHostRef}
            />
        ];
    }

    return (
        <section
            id={`slide-${slide.noteId}`}
            data-note-id={slide.noteId}
            className={desktopWebViewSrc ? "web-view-slide"
                : slide.isCollection ? "collection-slide"
                : isCanvasEdited ? "edited-canvas-slide" : undefined}
            data-background-color={slide.backgroundColor}
            data-background-gradient={slide.backgroundGradient}
            data-background-iframe={backgroundIframe}
            data-background-interactive={backgroundIframe ? "" : undefined}
            onDblClick={editorHostRef || isCanvasEdited ? undefined : onEdit}
        >
            {renderContent()}
        </section>
    );
}

interface CollectionSlidesProps {
    presentation: PresentationModel;
    ntxId: string | null | undefined;
    /** The note of the slide being edited, whose collection alone can be changed and open its notes. */
    editedNoteId: string | undefined;
    onOpenNote: ((noteId: string) => void) | undefined;
}

/**
 * Renders the collection of each collection slide with the app's own note list, as children of the shadow
 * host that its slide's `<slot>` shows. Outside the shadow root, the document's stylesheets style the
 * collection and the slide's theme does not; the collection is still drawn, scaled and moved with its slide.
 */
export function CollectionSlides({ presentation, ntxId, editedNoteId, onOpenNote }: CollectionSlidesProps) {
    const slides = presentation.slides.flatMap(slide => [ slide, ...slide.verticalSlides ?? [] ]);
    return (
        <>
            {slides.filter(slide => slide.isCollection).map(slide => {
                const note = froca.getNoteFromCache(slide.noteId);
                if (!note) return null;
                const isEdited = slide.noteId === editedNoteId;
                return (
                    <div
                        key={slide.noteId}
                        slot={getCollectionSlotName(slide.noteId)}
                        className={`presentation-collection-slide ${isEdited ? "is-edited" : ""}`}
                    >
                        <Suspense fallback={null}>
                            <EmbeddedNoteList
                                note={note}
                                notePath={note.getBestNotePathString()}
                                ntxId={ntxId}
                                media="screen"
                                isReadOnly={!isEdited}
                                // Opening a note leaves the presentation, or opens a popup that full-screen hides.
                                onOpenNote={isEdited ? onOpenNote : ignoreOpenNote}
                            />
                        </Suspense>
                    </div>
                );
            })}
        </>
    );
}

function ignoreOpenNote() {}

function getCollectionSlotName(noteId: string) {
    return `collection-${noteId}`;
}

export function getCanvasEditorSlotName(noteId: string) {
    return `canvas-editor-${noteId}`;
}
