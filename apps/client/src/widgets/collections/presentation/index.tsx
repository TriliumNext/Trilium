import "./index.css";

import multicolumnStylesheet from "@triliumnext/ckeditor5/src/theme/multicolumn.css?raw";
import { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import Reveal, { RevealApi } from "reveal.js";
import slideBaseStylesheet from "reveal.js/reveal.css?raw";

import { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import katexStylesheet from "../../../services/katex.scss?inline";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { useEffectiveReadOnly, useNoteContext, useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import ShadowDom from "../../react/ShadowDom";
import { ViewModeMedia, ViewModeProps } from "../interface";
import { buildPresentationModel, PresentationModel, PresentationSlideBaseModel } from "./model";
import slideCustomStylesheet from "./slidejs.css?raw";
import { DEFAULT_THEME, loadPresentationTheme } from "./themes";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

export default function PresentationView({ note, noteIds, media, onReady, onProgressChanged }: ViewModeProps<{}>) {
    const [ presentation, setPresentation ] = useState<PresentationModel>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ api, setApi ] = useState<RevealApi>();
    const stylesheets = usePresentationStylesheets(note, media);
    const { noteContext } = useNoteContext();
    const isReadOnly = useEffectiveReadOnly(note, noteContext);

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
            <Presentation presentation={presentation} setApi={setApi} />
        </>
    );

    if (media === "screen") {
        return (
            <div class="presentation-view">
                <CollectionProperties
                    note={note}
                    rightChildren={<ButtonOverlay containerRef={containerRef} api={api} isReadOnly={isReadOnly} />}
                />
                <ShadowDom
                    className="presentation-container"
                    containerRef={containerRef}
                >{content}</ShadowDom>
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

function ButtonOverlay({ containerRef, api, isReadOnly }: { containerRef: RefObject<HTMLDivElement | null>, api: RevealApi | undefined, isReadOnly: boolean }) {
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

function Presentation({ presentation, setApi } : { presentation: PresentationModel, setApi: (api: RevealApi | undefined) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [revealApi, setRevealApi] = useState<RevealApi>();

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

                return true;
            },
        });
        const container = containerRef.current;
        const fit = () => {
            fitSlides(container);
            if (api.isReady()) api.layout();
        };
        const fitLoadedImage = (e: Event) => {
            const content = (e.target as HTMLElement).closest<HTMLElement>(".slide-content");
            if (!content) return;
            fitSlideContent(content);
            if (api.isReady()) api.layout();
        };

        // Reveal.js shows only the slides near the current one, so the others are fitted once they appear.
        api.on("ready", fit);
        api.on("slidechanged", fit);
        api.on("overviewshown", fit);
        container.addEventListener("load", fitLoadedImage, true);
        document.fonts.ready.then(fit);

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
            container.removeEventListener("load", fitLoadedImage, true);
            resizeObserver.disconnect();
            api.destroy();
            setRevealApi(undefined);
            setApi(undefined);
        };
    }, []);

    useEffect(() => {
        if (!revealApi || !containerRef.current) return;
        revealApi.sync();
        fitSlides(containerRef.current);
        revealApi.layout();
    }, [ presentation, revealApi ]);

    return (
        <div ref={containerRef} className="reveal">
            <div className="slides">
                {presentation.slides?.map(slide => {
                    if (!slide.verticalSlides) {
                        return <Slide key={slide.noteId} slide={slide} />;
                    }
                    return (
                        <section>
                            <Slide key={slide.noteId} slide={slide} />
                            {slide.verticalSlides.map(slide => <Slide key={slide.noteId} slide={slide} /> )}
                        </section>
                    );

                })}
            </div>
        </div>
    );

}

function Slide({ slide }: { slide: PresentationSlideBaseModel }) {
    return (
        <section
            id={`slide-${slide.noteId}`}
            data-note-id={slide.noteId}
            data-background-color={slide.backgroundColor}
            data-background-gradient={slide.backgroundGradient}
        >
            <div className="slide-content" dangerouslySetInnerHTML={slide.content} />
        </section>
    );
}

function fitSlides(container: HTMLElement) {
    for (const content of container.querySelectorAll<HTMLElement>(".slide-content")) {
        fitSlideContent(content);
    }
}

/**
 * Zooms out the content of a slide that is larger than the slide, so that it fits. A hidden slide measures
 * as empty and keeps no zoom until it is fitted again.
 */
export function fitSlideContent(content: HTMLElement) {
    content.style.zoom = "";
    const scale = Math.min(1, SLIDE_WIDTH / content.scrollWidth, SLIDE_HEIGHT / content.scrollHeight);
    if (scale < 1) {
        content.style.zoom = String(scale);
    }
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
