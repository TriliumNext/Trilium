import { ViewModeProps } from "../interface";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import Reveal from "reveal.js";
import slideBaseStylesheet from "reveal.js/dist/reveal.css?raw";
import slideCustomStylesheet from "./slidejs.css?raw";
import { buildPresentationModel, PresentationModel, PresentationSlideBaseModel } from "./model";
import ShadowDom from "../../react/ShadowDom";
import ActionButton from "../../react/ActionButton";
import "./index.css";
import { RefObject } from "preact";
import { openInCurrentNoteContext } from "../../../components/note_context";
import { useNoteLabelWithDefault, useTriliumEvent } from "../../react/hooks";
import { t } from "../../../services/i18n";
import { DEFAULT_THEME, loadPresentationTheme } from "./themes";
import FNote from "../../../entities/fnote";

export default function PresentationView({ note, noteIds }: ViewModeProps<{}>) {
    const [ presentation, setPresentation ] = useState<PresentationModel>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [ api, setApi ] = useState<Reveal.Api>();
    const stylesheets = usePresentationStylesheets(note);

    function refresh() {
        buildPresentationModel(note).then(setPresentation);
    }

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().find(noteId => noteIds.includes(noteId)) ||
            loadResults.getAttributeRows().find(attr => attr.noteId && attr.name?.startsWith("slide:") && noteIds.includes(attr.noteId))) {
            refresh();
        }
    });

    useLayoutEffect(refresh, [ note, noteIds ]);

    return presentation && stylesheets && (
        <>
            <ShadowDom
                className="presentation-container"
                containerRef={containerRef}
            >
                {stylesheets.map(stylesheet => <style>{stylesheet}</style>)}
                <Presentation presentation={presentation} setApi={setApi} />
            </ShadowDom>
            <ButtonOverlay containerRef={containerRef} api={api} />
        </>
    )
}

function usePresentationStylesheets(note: FNote) {
    const [ themeName ] = useNoteLabelWithDefault(note, "presentation:theme", DEFAULT_THEME);
    const [ stylesheets, setStylesheets ] = useState<string[]>();

    useLayoutEffect(() => {
        loadPresentationTheme(themeName).then((themeStylesheet) => {
            setStylesheets([
                slideBaseStylesheet,
                themeStylesheet,
                slideCustomStylesheet
            ].map(stylesheet => stylesheet.replace(/:root/g, ":host")));
        });
    }, [ themeName ]);

    return stylesheets;
}

function ButtonOverlay({ containerRef, api }: { containerRef: RefObject<HTMLDivElement>, api: Reveal.Api | undefined }) {
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
        <div className="presentation-button-bar">
            <div className="floating-buttons-children">
                <ActionButton
                    className="floating-button"
                    icon="bx bx-edit"
                    text={t("presentation_view.edit-slide")}
                    noIconActionClass
                    onClick={e => {
                        const currentSlide = api?.getCurrentSlide();
                        const noteId = getNoteIdFromSlide(currentSlide);

                        if (noteId) {
                            openInCurrentNoteContext(e, noteId);
                        }
                    }}
                />

                <ActionButton
                    className="floating-button"
                    icon="bx bx-grid-horizontal"
                    text={t("presentation_view.slide-overview")}
                    active={isOverviewActive}
                    noIconActionClass
                    onClick={() => api?.toggleOverview()}
                />

                <ActionButton
                    className="floating-button"
                    icon="bx bx-fullscreen"
                    text={t("presentation_view.start-presentation")}
                    noIconActionClass
                    onClick={() => containerRef.current?.requestFullscreen()}
                />
            </div>
        </div>
    )
}

function Presentation({ presentation, setApi } : { presentation: PresentationModel, setApi: (api: Reveal.Api | undefined) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [revealApi, setRevealApi] = useState<Reveal.Api>();

    useEffect(() => {
        if (!containerRef.current) return;

        const api = new Reveal(containerRef.current, {
            transition: "slide",
            embedded: true,
            keyboardCondition(event) {
                // Full-screen requests sometimes fail, we rely on the UI button instead.
                if (event.key === "f") {
                    return false;
                }

                return true;
            },
        });
        api.initialize().then(() => {
            setRevealApi(api);
            setApi(api);

            if (containerRef.current) {
                rewireLinks(containerRef.current, api);
            }
        });

        return () => {
            api.destroy();
            setRevealApi(undefined);
            setApi(undefined);
        }
    }, []);

    useEffect(() => {
        revealApi?.sync();
    }, [ presentation, revealApi ]);

    return (
        <div ref={containerRef} className="reveal">
            <div className="slides">
                {presentation.slides?.map(slide => {
                    if (!slide.verticalSlides) {
                        return <Slide key={slide.noteId} slide={slide} />
                    } else {
                        return (
                            <section>
                                <Slide key={slide.noteId} slide={slide} />
                                {slide.verticalSlides.map(slide => <Slide key={slide.noteId} slide={slide} /> )}
                            </section>
                        );
                    }
                })}
            </div>
        </div>
    )

}

function Slide({ slide }: { slide: PresentationSlideBaseModel }) {
    return (
        <section
            id={`slide-${slide.noteId}`}
            data-note-id={slide.noteId}
            data-background-color={slide.backgroundColor}
            data-background-gradient={slide.backgroundGradient}
            dangerouslySetInnerHTML={slide.content}
        />
    );
}

function getNoteIdFromSlide(slide: HTMLElement | undefined) {
    if (!slide) return;
    return slide.dataset.noteId;
}

function rewireLinks(container: HTMLElement, api: Reveal.Api) {
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
