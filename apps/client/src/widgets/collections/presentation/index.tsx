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
import utils from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { useEffectiveReadOnly, useNoteContext, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import ShadowDom from "../../react/ShadowDom";
import { DesktopWebView } from "../../type_widgets/WebView";
import { ViewModeMedia, ViewModeProps } from "../interface";
import { buildPresentationModel, PresentationModel, PresentationSlideBaseModel } from "./model";
import slideCustomStylesheet from "./slidejs.css?raw";
import { DEFAULT_THEME, loadPresentationTheme } from "./themes";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;
const isElectron = utils.isElectron();
const MAX_FIT_ATTEMPTS = 8;
const SlideEditor = lazy(() => import("./slide_editor"));

export default function PresentationView({ note, noteIds, media, onReady, onProgressChanged }: ViewModeProps<{}>) {
    const [ presentation, setPresentation ] = useState<PresentationModel>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ api, setApi ] = useState<RevealApi>();
    const stylesheets = usePresentationStylesheets(note, media);
    const { noteContext } = useNoteContext();
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const [ editedNoteId, setEditedNoteId ] = useState<string>();
    const [ editorHost, setEditorHost ] = useState<HTMLElement | null>(null);
    const editedNote = editedNoteId ? froca.getNoteFromCache(editedNoteId) : undefined;
    const finishEditing = () => setEditedNoteId(undefined);

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

    function refresh() {
        buildPresentationModel(note, onProgressChanged).then(setPresentation);
    }

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().find(noteId => noteIds.includes(noteId)) ||
            loadResults.getAttributeRows().find(attr => attr.noteId && attr.name?.startsWith("slide:") && noteIds.includes(attr.noteId))) {
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
                onEditSlide={media === "screen" && !isReadOnly ? setEditedNoteId : undefined}
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
                <ShadowDom
                    className="presentation-container"
                    containerRef={containerRef}
                >{content}</ShadowDom>
                {/* A portal keeps the editor in this tree, whose contexts the shadow root's tree lacks. */}
                {editedNote && editorHost && createPortal(
                    // Its own boundary, so that loading the editor does not suspend the presentation.
                    <Suspense fallback={null}>
                        <SlideEditor note={editedNote} onFinish={finishEditing} />
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
    /** Starts editing a text slide in place; left out when the presentation cannot be edited. */
    onEditSlide: ((noteId: string) => void) | undefined;
    /** Receives the element that the editor of the edited slide goes into. */
    onEditorHost: (element: HTMLElement | null) => void;
}

function Presentation({ presentation, setApi, ntxId, editedNoteId, onEditSlide, onEditorHost }: PresentationProps) {
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

                // Reveal.js checks `document.activeElement`, which is the shadow host rather than
                // the slide editor inside it.
                const target = event.composedPath()[0];
                return !(target instanceof HTMLElement && target.isContentEditable);
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
            rewireLinks(container, api);
        });

        // Reveal.js listens only to window resizes, not to the note pane changing size.
        const resizeObserver = new ResizeObserver(() => {
            if (api.isReady()) api.layout();
        });
        resizeObserver.observe(container);

        return () => {
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
        const canEdit = onEditSlide && slide.type === "text";
        return (
            <Slide
                key={slide.noteId}
                slide={slide}
                ntxId={ntxId}
                editorHostRef={slide.noteId === editedNoteId ? onEditorHost : undefined}
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
    /** Starts editing the slide in place, on a double-click. */
    onEdit?: () => void;
}

export function Slide({ slide, ntxId, editorHostRef, onEdit }: SlideProps) {
    // On desktop a web view goes in an Electron `<webview>`, whose own session keeps the page away
    // from the app; elsewhere Reveal.js frames it in the slide's background.
    const desktopWebViewSrc = isElectron ? slide.webViewSrc : undefined;
    const backgroundIframe = isElectron ? undefined : slide.webViewSrc;

    function renderContent() {
        if (desktopWebViewSrc) return <DesktopWebView src={desktopWebViewSrc} ntxId={ntxId} />;
        // The keys keep Preact from reusing the rendered content's element, and its zoom, for the editor.
        if (editorHostRef) return <div key="editor" className="slide-content slide-editor" ref={editorHostRef} />;
        return <div key="content" className="slide-content" dangerouslySetInnerHTML={slide.content} />;
    }

    return (
        <section
            id={`slide-${slide.noteId}`}
            data-note-id={slide.noteId}
            className={desktopWebViewSrc ? "web-view-slide" : undefined}
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
 * Fits each observed slide content again whenever its size changes: an image or a font loads, the theme
 * changes, or Reveal.js shows a slide it had hidden. The size each fit leaves behind is remembered, so the
 * fit's own zoom does not trigger another fit.
 */
export function createFitObserver(onFitted: () => void) {
    const fittedSizes = new WeakMap<Element, string>();
    return new ResizeObserver((entries) => {
        let fitted = false;
        for (const { target } of entries) {
            if (!(target instanceof HTMLElement) || fittedSizes.get(target) === measureSize(target)) continue;
            fitSlideContent(target);
            fittedSizes.set(target, measureSize(target));
            fitted = true;
        }
        if (fitted) onFitted();
    });
}

function measureSize(element: HTMLElement) {
    return `${element.offsetWidth}x${element.offsetHeight}`;
}

/**
 * Zooms out the content of a slide that is larger than the slide, so that it fits. A hidden slide measures
 * as empty and keeps no zoom until it is fitted again.
 *
 * Some lengths (percentages, container query units) do not scale with `zoom`, so the content is measured
 * again after each zoom. The overflow is close to linear in the zoom, so each next zoom is a secant step.
 */
export function fitSlideContent(content: HTMLElement) {
    content.style.zoom = "";
    let previous = { scale: 1, overflow: measureOverflow(content) };
    if (previous.overflow <= 1) return;

    let scale = 1 / previous.overflow;
    for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
        content.style.zoom = String(scale);
        const overflow = measureOverflow(content);
        if (overflow <= 1) break;

        const slope = (previous.overflow - overflow) / (previous.scale - scale);
        const next = scale - (overflow - 1) / slope;
        previous = { scale, overflow };
        scale = slope > 0 && next > 0 ? next : scale / overflow;
    }
}

/** Returns how many times larger the content is than the slide, as measured on screen. */
function measureOverflow(content: HTMLElement) {
    const slides = content.closest<HTMLElement>(".slides");
    const slidesHeight = slides?.getBoundingClientRect().height;
    if (!slidesHeight || !content.clientWidth) return 0;

    const heightRatio = content.getBoundingClientRect().height / slidesHeight;
    const widthRatio = content.scrollWidth / content.clientWidth;
    return Math.max(heightRatio, widthRatio);
}

function getNoteIdFromSlide(slide: HTMLElement | undefined) {
    if (!slide) return;
    return slide.dataset.noteId;
}

function rewireLinks(container: HTMLElement, api: RevealApi) {
    const links = container.querySelectorAll<HTMLLinkElement>("a.reference-link");
    for (const link of links) {
        link.addEventListener("click", () => {
            /**
             * Reveal.js has built-in navigation by either index or ID. However, the ID-based navigation doesn't work because it tries to look
             * outside the shadom DOM (via document.getElementById).
             */
            const url = new URL(link.href);
            if (!url.hash.startsWith("#/slide-")) return;
            const targetId = url.hash.substring(8);
            const slide = container.querySelector<HTMLElement>(`#slide-${targetId}`);
            if (!slide) return;

            const { h, v, f } = api.getIndices(slide);
            api.slide(h, v, f);
        });
    }
}
