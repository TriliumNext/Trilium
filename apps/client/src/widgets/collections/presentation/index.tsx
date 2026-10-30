import "./index.css";

import multicolumnStylesheet from "@triliumnext/ckeditor5/src/theme/multicolumn.css?raw";
import { createPortal, RefObject } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { RevealApi } from "reveal.js";
import slideBaseStylesheet from "reveal.js/reveal.css?raw";

import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import katexStylesheet from "../../../services/katex.scss?inline";
import options from "../../../services/options";
import CollectionProperties from "../../note_bars/CollectionProperties";
import { SplitButton } from "../../react/Button";
import {
    useEffectiveReadOnly, useNoteContext, useNoteLabelWithDefault, useTriliumEvent, useTriliumOptionBool
} from "../../react/hooks";
import NoItems from "../../react/NoItems";
import ShadowDom from "../../react/ShadowDom";
import { ViewModeMedia, ViewModeProps } from "../interface";
import { useClosingSlides } from "./closing_slides";
import {
    applySlideMove, buildPresentationModel, createSlide, deleteSlide, duplicateSlide, getNewSlidePosition,
    getNewVerticalSlidePosition, getSlideMove, getSlideParentNoteId, isSlideRebuilt, moveSlideNote, NewSlidePosition,
    NewSlideType, PresentationModel, SlideMove
} from "./model";
import { getNoteIdFromSlide, goToSlide, useActiveSlideNoteId } from "./reveal";
import SlideSidebar from "./sidebar";
import slideCustomStylesheet from "./slidejs.css?raw";
import { SlideMenuActions } from "./slide_menu";
import { CollectionSlides, Presentation } from "./slides";
import { DEFAULT_THEME, loadPresentationTheme } from "./themes";
import PresentationToolbarActions, { NewSlideTypeItems, SlideSidebarToggle } from "./toolbar";

const SlideEditor = lazy(() => import("./slide_editor"));

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
    const startPresentation = () => void containerRef.current?.requestFullscreen();
    const canEditSlides = media === "screen" && !isReadOnly && !options.is("databaseReadonly");
    const closingSlides = useClosingSlides(refresh);
    const refreshIdRef = useRef(0);
    const activeNoteId = useActiveSlideNoteId(api);
    // A slide that the presentation goes to once the model has it, and starts editing for a new slide.
    const [ pendingSlide, setPendingSlide ] = useState<{ noteId: string, edit: boolean }>();
    const canAddSlides = canEditSlides && note.type !== "search";
    const [ isSidebarVisible, setSidebarVisible ] = useTriliumOptionBool("presentationSidebarVisible");

    async function addSlide(position: NewSlidePosition, type: NewSlideType = "text") {
        const noteId = await createSlide(position, type);
        // Only a text slide has an editor in place.
        if (noteId) setPendingSlide({ noteId, edit: type === "text" });
    }

    function editSlide(noteId: string) {
        if (!api) return;
        if (api.isOverview()) api.toggleOverview(false);
        goToSlide(api, noteId);
        startEditing(noteId);
    }

    const slideChanges: SlideMenuActions["changes"] = {
        addSlideAfter(noteId, type) {
            if (presentation) void addSlide(getNewSlidePosition(presentation, note.noteId, noteId), type);
        },
        addVerticalSlide(noteId, type) {
            if (presentation) void addSlide(getNewVerticalSlidePosition(presentation, noteId), type);
        },
        async duplicate(noteId) {
            if (!presentation) return;
            const copyNoteId = await duplicateSlide(presentation, note.noteId, noteId);
            if (copyNoteId) setPendingSlide({ noteId: copyNoteId, edit: false });
        },
        async delete(noteId) {
            if (!presentation || !await deleteSlide(presentation, note.noteId, noteId)) return;
            // The editor of a deleted slide, or of one of its vertical slides, goes away with it.
            if (editedNoteId === noteId
                || (editedNoteId && getSlideParentNoteId(presentation, note.noteId, editedNoteId) === noteId)) {
                finishEditing();
            }
        }
    };

    // Shown at once, before the server confirms; the model rebuilt after the move replaces it.
    async function moveSlide(move: SlideMove) {
        if (!presentation) return;
        const moved = applySlideMove(presentation, move);
        // A section built anew drops the editor that was in it.
        if (editedNoteId && isSlideRebuilt(presentation, moved, editedNoteId)) finishEditing();
        ++refreshIdRef.current;
        setPresentation(moved);
        try {
            if (await moveSlideNote(presentation, note.noteId, move)) return;
        } catch (e) {
            console.error(e);
        }
        refresh();
    }

    function onPendingSlideShown(noteId: string) {
        if (pendingSlide?.edit) startEditing(noteId);
        setPendingSlide(undefined);
    }

    const editedNoteIdRef = useRef(editedNoteId);
    editedNoteIdRef.current = editedNoteId;

    useEffect(() => {
        if (!api) return;
        // A moved slide keeps its edit, as `keepSlideShown()` changes only its position.
        const onSlideChanged = (e: Event) => {
            const currentSlide = (e as Event & { currentSlide?: HTMLElement }).currentSlide;
            if (getNoteIdFromSlide(currentSlide) !== editedNoteIdRef.current) finishEditing();
        };
        api.on("slidechanged", onSlideChanged);
        api.on("overviewshown", finishEditing);
        // The editor's toolbars are in `document.body`, which full-screen hides.
        document.addEventListener("fullscreenchange", finishEditing);
        return () => {
            api.off("slidechanged", onSlideChanged);
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
        // An empty presentation has no Reveal.js to wait for.
        if (presentation && !presentation.slides.length) {
            setTimeout(onReady);
            // The editor went away with the slide it was in.
            finishEditing();
        }
        // We need to wait for Reveal.js to initialize (by setting api) and for the presentation to become available.
        else if (api && presentation) {
            // Timeout is necessary because it otherwise can cause flakiness by rendering only the first slide.
            setTimeout(onReady, 200);
        }
    }, [ api, presentation ]);

    if (!presentation || !stylesheets) return;
    const isEmpty = !presentation.slides.length;
    if (isEmpty && media !== "screen") return;
    const activeSlide = presentation.slides
        .flatMap(slide => [ slide, ...slide.verticalSlides ?? [] ])
        .find(slide => slide.noteId === activeNoteId);
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
                pendingNoteId={pendingSlide?.noteId}
                onPendingSlideShown={onPendingSlideShown}
                onStartPresentation={media === "screen" ? startPresentation : undefined}
            />
        </>
    );

    if (media === "screen") {
        return (
            <div class="presentation-view">
                <CollectionProperties
                    note={note}
                    leftChildren={<SlideSidebarToggle
                        isVisible={isSidebarVisible}
                        hasSlides={!isEmpty}
                        onToggle={() => void setSidebarVisible(!isSidebarVisible)}
                    />}
                    rightChildren={<PresentationToolbarActions
                        onStartPresentation={startPresentation}
                        api={api}
                        hasSlides={!isEmpty}
                        isReadOnly={isReadOnly}
                        isEditing={!!editedNoteId}
                        onFinishEditing={finishEditing}
                        onNewSlide={canAddSlides
                            ? (type) => void addSlide(
                                getNewSlidePosition(presentation, note.noteId, activeNoteId), type
                            )
                            : undefined}
                        backgroundSlide={canEditSlides ? { slide: activeSlide } : undefined}
                    />}
                />
                <div className="presentation-body">
                    {isSidebarVisible && !isEmpty && <SlideSidebar
                        presentation={presentation}
                        stylesheets={stylesheets}
                        closingContents={closingSlides.contents}
                        activeNoteId={activeNoteId}
                        onSelectSlide={(noteId) => api && goToSlide(api, noteId)}
                        planSlideMove={canAddSlides ? (noteId, gap, levelShift) => getSlideMove(
                            presentation, note.noteId, noteId, gap, levelShift,
                            (parentNoteId) => !!froca.getNoteFromCache(parentNoteId)?.hasLabel("sorted")
                        ) : undefined}
                        onMoveSlide={canAddSlides ? (move) => void moveSlide(move) : undefined}
                        slideMenuActions={{
                            onEdit: canEditSlides ? editSlide : undefined,
                            changes: canAddSlides ? slideChanges : undefined
                        }}
                    />}
                    {isEmpty ? (
                        <NoItems icon="bx bx-slideshow" text={t("presentation_view.no-slides")}>
                            {canAddSlides && <SplitButton
                                text={t("presentation_view.new-slide")}
                                icon="bx bx-plus"
                                kind="primary"
                                onClick={() => void addSlide(getNewSlidePosition(presentation, note.noteId, undefined))}
                            >
                                <NewSlideTypeItems onNewSlide={(type) => (
                                    void addSlide(getNewSlidePosition(presentation, note.noteId, undefined), type)
                                )} />
                            </SplitButton>}
                        </NoItems>
                    ) : (
                        <ShadowDom
                            className="presentation-container"
                            containerRef={containerRef}
                        >{content}</ShadowDom>
                    )}
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

