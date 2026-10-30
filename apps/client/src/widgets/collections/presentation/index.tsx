import "./index.css";

import multicolumnStylesheet from "@triliumnext/ckeditor5/src/theme/multicolumn.css?raw";
import { createPortal, RefObject } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import Reveal, { RevealApi } from "reveal.js";
import slideBaseStylesheet from "reveal.js/reveal.css?raw";

import { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import katexStylesheet from "../../../services/katex.scss?inline";
import options from "../../../services/options";
import utils from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { useEffectiveReadOnly, useNoteContext, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import ShadowDom from "../../react/ShadowDom";
import { DesktopWebView } from "../../type_widgets/WebView";
import { ViewModeMedia, ViewModeProps } from "../interface";
import { createFitObserver } from "./fit";
import {
    buildPresentationModel, PresentationModel, PresentationSlideBaseModel, renderSlideContent
} from "./model";
import SlideSidebar from "./sidebar";
import slideCustomStylesheet from "./slidejs.css?raw";
import { DEFAULT_THEME, loadPresentationTheme } from "./themes";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const isElectron = utils.isElectron();
const SlideEditor = lazy(() => import("./slide_editor"));
const EmbeddedNoteList = lazy(() => import("../NoteList").then(({ EmbeddedNoteList }) => ({ default: EmbeddedNoteList })));

export default function PresentationView({ note, noteIds, media, onReady, onProgressChanged, onOpenNote }: ViewModeProps<{}>) {
    const [ presentation, setPresentation ] = useState<PresentationModel>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ api, setApi ] = useState<RevealApi>();
    const stylesheets = usePresentationStylesheets(note, media);
    const { noteContext } = useNoteContext();
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ editedNoteId, setEditedNoteId ] = useState<string>();
    const [ editorHost, setEditorHost ] = useState<HTMLElement | null>(null);
    const editedNote = editedNoteId ? froca.getNoteFromCache(editedNoteId) : undefined;
    const [ readyEditorNoteId, setReadyEditorNoteId ] = useState<string>();
    // Each edit waits for its own editor, so editing the same slide again starts out not ready.
    const startEditing = (noteId: string) => {
        setReadyEditorNoteId(undefined);
        setEditedNoteId(noteId);
    };
    const finishEditing = () => {
        setEditedNoteId(undefined);
        setReadyEditorNoteId(undefined);
    };
    const shadowHost = useElementOf(containerRef);
    const canEditSlides = media === "screen" && !isReadOnly && !options.is("databaseReadonly");
    const closingSlides = useClosingSlides(refresh);
    const refreshIdRef = useRef(0);
    const activeNoteId = useActiveSlideNoteId(api);

    useEffect(() => {
        if (!api) return;
        api.on("slidechanged", finishEditing);
        api.on("overviewshown", finishEditing);
        // The editor's toolbars are in `document.body`, which full-screen hides.
        document.addEventListener("fullscreenchange", finishEditing);
        return () => {
            api.off("slidechanged", finishEditing);
            api.off("overviewshown", finishEditing);
            document.removeEventListener("fullscreenchange", finishEditing);
        };
    }, [ api ]);

    // Only the latest model applies, as an earlier one can land later.
    function refresh() {
        const refreshId = ++refreshIdRef.current;
        const savedSlides = closingSlides.getSaved();
        buildPresentationModel(note, onProgressChanged).then((model) => {
            if (refreshId !== refreshIdRef.current) return;
            setPresentation(model);
            closingSlides.release(savedSlides);
        });
    }

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().find(noteId => noteIds.includes(noteId)) ||
            loadResults.getAttributeRows().find(attr => attr.noteId && noteIds.includes(attr.noteId)
                && (attr.name?.startsWith("slide:") || attr.name === "readOnly"))) {
            refresh();
        }
    });

    useLayoutEffect(refresh, [ note, noteIds ]);

    useEffect(() => {
        // We need to wait for Reveal.js to initialize (by setting api) and for the presentation to become available.
        if (api && presentation) {
            // Timeout is necessary because it otherwise can cause flakiness by rendering only the first slide.
            setTimeout(onReady, 200);
        }
    }, [ api, presentation ]);

    if (!presentation || !stylesheets || !note.hasChildren()) return;
    const content = (
        <>
            {stylesheets.map(stylesheet => <style>{stylesheet}</style>)}
            <Presentation
                presentation={presentation}
                setApi={setApi}
                ntxId={noteContext?.ntxId}
                editedNoteId={editedNoteId}
                isEditorReady={!!editedNoteId && readyEditorNoteId === editedNoteId}
                closingContents={closingSlides.contents}
                onEditSlide={canEditSlides ? startEditing : undefined}
                onEditorHost={setEditorHost}
            />
        </>
    );

    if (media === "screen") {
        return (
            <div class="presentation-view">
                <CollectionProperties
                    note={note}
                    rightChildren={<ButtonOverlay
                        containerRef={containerRef}
                        api={api}
                        isReadOnly={isReadOnly}
                        isEditing={!!editedNoteId}
                        onFinishEditing={finishEditing}
                    />}
                />
                <div className="presentation-body">
                    <SlideSidebar
                        presentation={presentation}
                        stylesheets={stylesheets}
                        closingContents={closingSlides.contents}
                        activeNoteId={activeNoteId}
                    />
                    <ShadowDom
                        className="presentation-container"
                        containerRef={containerRef}
                    >{content}</ShadowDom>
                </div>
                {shadowHost && createPortal(
                    <CollectionSlides
                        presentation={presentation}
                        ntxId={noteContext?.ntxId}
                        editedNoteId={editedNoteId}
                        onOpenNote={onOpenNote}
                    />,
                    shadowHost
                )}
                {/* A portal keeps the editor in this tree, whose contexts the shadow root's tree lacks. */}
                {editedNote && editorHost && createPortal(
                    // Its own boundary, so that loading the editor does not suspend the presentation.
                    <Suspense fallback={null}>
                        <SlideEditor
                            note={editedNote}
                            onReady={() => setReadyEditorNoteId(editedNote.noteId)}
                            onFinish={finishEditing}
                            onClose={(content, save) => (
                                closingSlides.onEditorClose(editedNote, content, save)
                            )}
                        />
                    </Suspense>,
                    editorHost
                )}
            </div>
        );
    } else if (media === "print") {
        // Printing needs a query parameter that is read by Reveal.js.
        const url = new URL(window.location.href);
        url.searchParams.set("print-pdf", "");
        window.history.replaceState({}, '', url);

        // Shadow DOM doesn't work well with Reveal.js's PDF printing mechanism.
        return content;
    }
}

/** Returns the element that `ref` holds once it is mounted, so that a render can depend on it. */
function useElementOf<T extends HTMLElement>(ref: RefObject<T | null>) {
    const [ element, setElement ] = useState<T | null>(null);
    useLayoutEffect(() => {
        if (ref.current !== element) setElement(ref.current);
    });
    return element;
}

/** Returns the note ID of the slide that Reveal.js shows. */
export function useActiveSlideNoteId(api: RevealApi | undefined) {
    const [ activeNoteId, setActiveNoteId ] = useState<string>();
    useEffect(() => {
        if (!api) return;
        const update = () => setActiveNoteId(getNoteIdFromSlide(api.getCurrentSlide()));
        update();
        api.on("slidechanged", update);
        return () => api.off("slidechanged", update);
    }, [ api ]);
    return activeNoteId;
}

type SlideContent = PresentationSlideBaseModel["content"];

/** An editor of a text slide that went away, while its last save runs. */
interface ClosingSlide {
    isSaving: boolean;
}

/**
 * Keeps the content of each text slide as its editor held it when it closed, rendered, until a
 * model built after the last save of the editor holds what the save stored. After a failed save,
 * the content stays until the next model. `refresh` builds the model again once a save succeeds.
 */
function useClosingSlides(refresh: () => void) {
    const [ contents, setContents ] = useState<Record<string, SlideContent>>({});
    const closingRef = useRef(new Map<string, ClosingSlide>());

    function onEditorClose(slideNote: FNote, content: string, save: Promise<boolean>) {
        const { noteId } = slideNote;
        const closing: ClosingSlide = { isSaving: true };
        closingRef.current.set(noteId, closing);
        void renderSlideContent(slideNote, content).then((rendered) => {
            if (closingRef.current.get(noteId) === closing) {
                setContents((current) => ({ ...current, [noteId]: rendered }));
            }
        });
        void save.then((isSaved) => {
            if (closingRef.current.get(noteId) !== closing) return;
            closing.isSaving = false;
            if (isSaved) refresh();
        });
    }

    /** Returns the closed editors whose save has landed, which a model built from now reflects. */
    function getSaved() {
        return [ ...closingRef.current ].filter(([ , closing ]) => !closing.isSaving);
    }

    /** Drops the content of the editors that `getSaved()` returned, once a later model applies. */
    function release(saved: [string, ClosingSlide][]) {
        const released = saved.filter(([ noteId, closing ]) => (
            closingRef.current.get(noteId) === closing
        ));
        if (!released.length) return;
        for (const [ noteId ] of released) closingRef.current.delete(noteId);
        setContents((current) => {
            const next = { ...current };
            for (const [ noteId ] of released) delete next[noteId];
            return next;
        });
    }

    return { contents, onEditorClose, getSaved, release };
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

function usePresentationStylesheets(note: FNote, media: ViewModeMedia) {
    const [ themeName ] = useNoteLabelWithDefault(note, "presentation:theme", DEFAULT_THEME);
    const [ stylesheets, setStylesheets ] = useState<string[]>();

    useLayoutEffect(() => {
        loadPresentationTheme(themeName).then((themeStylesheet) => {
            let stylesheets = [
                slideBaseStylesheet,
                themeStylesheet,
                katexStylesheet,
                multicolumnStylesheet,
                slideCustomStylesheet
            ];
            if (media === "screen") {
                // We are rendering in the shadow DOM, so the global variables are not set correctly.
                stylesheets = stylesheets.map(stylesheet => stylesheet.replace(/:root/g, ":host"));
            }
            setStylesheets(stylesheets);
        });
    }, [ themeName ]);

    return stylesheets;
}

interface ButtonOverlayProps {
    containerRef: RefObject<HTMLDivElement | null>;
    api: RevealApi | undefined;
    isReadOnly: boolean;
    isEditing: boolean;
    onFinishEditing(): void;
}

function ButtonOverlay({ containerRef, api, isReadOnly, isEditing, onFinishEditing }: ButtonOverlayProps) {
    const [ isOverviewActive, setIsOverviewActive ] = useState(false);
    useEffect(() => {
        if (!api) return;
        setIsOverviewActive(api.isOverview());
        const onEnabled = () => setIsOverviewActive(true);
        const onDisabled = () => setIsOverviewActive(false);
        api.on("overviewshown", onEnabled);
        api.on("overviewhidden", onDisabled);
        return () => {
            api.off("overviewshown", onEnabled);
            api.off("overviewhidden", onDisabled);
        };
    }, [ api ]);

    return (
        <>
            {isEditing && (
                <ActionButton
                    icon="bx bx-check"
                    text={t("presentation_view.finish-editing")}
                    onClick={onFinishEditing}
                />
            )}

            {!isReadOnly && (
                <ActionButton
                    icon="bx bx-edit"
                    text={t("presentation_view.edit-slide")}
                    onClick={e => {
                        const currentSlide = api?.getCurrentSlide();
                        const noteId = getNoteIdFromSlide(currentSlide);

                        if (noteId) {
                            openInCurrentNoteContext(e, noteId);
                        }
                    }}
                />
            )}

            <ActionButton
                icon="bx bx-grid-horizontal"
                text={t("presentation_view.slide-overview")}
                active={isOverviewActive}
                onClick={() => api?.toggleOverview()}
            />

            <ActionButton
                icon="bx bx-fullscreen"
                text={t("presentation_view.start-presentation")}
                onClick={() => containerRef.current?.requestFullscreen()}
            />
        </>
    );
}

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
    /** Starts editing a text or collection slide in place; left out when the presentation cannot be edited. */
    onEditSlide: ((noteId: string) => void) | undefined;
    /** Receives the element that the editor of the edited slide goes into. */
    onEditorHost: (element: HTMLElement | null) => void;
}

function Presentation({
    presentation, setApi, ntxId, editedNoteId, isEditorReady, closingContents, onEditSlide,
    onEditorHost
}: PresentationProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [revealApi, setRevealApi] = useState<RevealApi>();
    const fitObserverRef = useRef<ResizeObserver>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const api = new Reveal(containerRef.current, {
            transition: "slide",
            embedded: true,
            // Must match the aspect ratio of `.reveal` in slidejs.css.
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            minScale: 0,
            maxScale: Infinity,
            pdfMaxPagesPerSlide: 1,
            keyboardCondition(event) {
                // Full-screen requests sometimes fail, we rely on the UI button instead.
                if (event.key === "f") {
                    return false;
                }

                return !isTypingIn(event);
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
        revealApi.sync();

        fitObserver.disconnect();
        for (const content of containerRef.current.querySelectorAll(".slide-content")) {
            fitObserver.observe(content);
        }
    }, [ presentation, revealApi, editedNoteId ]);

    function renderSlide(slide: PresentationSlideBaseModel) {
        const isEdited = slide.noteId === editedNoteId;
        const canEdit = onEditSlide && !isEdited && !slide.isReadOnly
            && (slide.type === "text" || slide.isCollection);
        const closingContent = closingContents[slide.noteId];
        return (
            <Slide
                key={slide.noteId}
                slide={closingContent ? { ...slide, content: closingContent } : slide}
                ntxId={ntxId}
                // A collection slide is edited in its own view, so it takes no editor.
                editorHostRef={isEdited && !slide.isCollection ? onEditorHost : undefined}
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
                        <section>
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
    /** Starts editing the slide in place, on a double-click. */
    onEdit?: () => void;
}

export function Slide({ slide, ntxId, editorHostRef, isEditorReady, onEdit }: SlideProps) {
    // On desktop a web view goes in an Electron `<webview>`, whose own session keeps the page away
    // from the app; elsewhere Reveal.js frames it in the slide's background.
    const desktopWebViewSrc = isElectron ? slide.webViewSrc : undefined;
    const backgroundIframe = isElectron ? undefined : slide.webViewSrc;

    function renderContent() {
        if (desktopWebViewSrc) return <DesktopWebView src={desktopWebViewSrc} ntxId={ntxId} />;
        if (slide.isCollection) return <slot name={getCollectionSlotName(slide.noteId)} />;
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
            className={desktopWebViewSrc ? "web-view-slide" : slide.isCollection ? "collection-slide" : undefined}
            data-background-color={slide.backgroundColor}
            data-background-gradient={slide.backgroundGradient}
            data-background-iframe={backgroundIframe}
            data-background-interactive={backgroundIframe ? "" : undefined}
            onDblClick={editorHostRef ? undefined : onEdit}
        >
            {renderContent()}
        </section>
    );
}

/**
 * Whether a key press goes to a field being typed in: the slide editor, or an input of a collection slide.
 * Reveal.js checks `document.activeElement` for that, which is the shadow host rather than the field.
 */
export function isTypingIn(event: Event) {
    const target = event.composedPath()[0];
    return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}

function getNoteIdFromSlide(slide: HTMLElement | undefined) {
    if (!slide) return;
    return slide.dataset.noteId;
}

const FRAME_SELECTOR = "iframe, webview";

/**
 * Takes the keyboard back whenever an iframe or `<webview>` in the slides gets focus, from a click or from
 * the page focusing itself, so that Space and the arrow keys keep moving between slides. Clicks, links and
 * wheel scrolling still reach the page. Chromium reports focus entering a frame as `focusin` on its
 * element; Firefox only blurs the window, so the frame is then found as the active element.
 */
export function keepKeyboardInPresentation(container: HTMLElement) {
    const returnFocus = (frame: HTMLElement) => {
        frame.blur();
        window.focus();
    };
    const onFocusIn = (e: Event) => {
        if (e.target instanceof HTMLElement && e.target.matches(FRAME_SELECTOR)) returnFocus(e.target);
    };
    const onWindowBlur = () => {
        // The frame becomes the active element only after the window's `blur` is dispatched.
        setTimeout(() => {
            const active = (container.getRootNode() as Document | ShadowRoot).activeElement;
            if (active instanceof HTMLElement && active.matches(FRAME_SELECTOR) && container.contains(active)) {
                returnFocus(active);
            }
        });
    };

    container.addEventListener("focusin", onFocusIn);
    window.addEventListener("blur", onWindowBlur);
    return () => {
        container.removeEventListener("focusin", onFocusIn);
        window.removeEventListener("blur", onWindowBlur);
    };
}

/**
 * Moves to the slide that a clicked link in `container` points at, including the links of content
 * rendered after this starts. Returns the function that stops it.
 *
 * Reveal.js navigates by slide ID on its own, but looks the slide up with
 * `document.getElementById()`, which does not find it inside the shadow root.
 */
export function followSlideLinks(container: HTMLElement, api: RevealApi) {
    const onClick = (e: MouseEvent) => {
        const link = e.target instanceof Element
            ? e.target.closest<HTMLAnchorElement>("a.reference-link")
            : null;
        if (!link) return;
        const url = new URL(link.href);
        if (!url.hash.startsWith("#/slide-")) return;
        const targetId = url.hash.substring(8);
        const slide = container.querySelector<HTMLElement>(`#slide-${targetId}`);
        if (!slide) return;

        const { h, v, f } = api.getIndices(slide);
        api.slide(h, v, f);
    };

    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
}
