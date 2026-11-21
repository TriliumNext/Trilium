import "./NoteDetail.css";

import clsx from "clsx";
import { isValidElement, VNode } from "preact";
import {
    useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";

import appContext, { type EventData, type EventNames } from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import type FAttachment from "../entities/fattachment";
import FNote from "../entities/fnote";
import type { PrintReport } from "../print";
import attributes from "../services/attributes";
import froca from "../services/froca";
import { t } from "../services/i18n";
import protected_session_holder from "../services/protected_session_holder";
import { isMobile } from "../services/utils";
import { ExtendedNoteType, TYPE_MAPPINGS, TypeWidget } from "./note_types";
import Button from "./react/Button";
import { useTriliumEvent } from "./react/hooks/events";
import { useDelayedVisibility, useParentClass } from "./react/hooks/dom";
import { useGetContextDataFrom, useNoteContext } from "./react/hooks/note_context";
import { useLegacyComponentElement } from "./react/hooks/legacy";
import Icon from "./react/Icon";
import NoItems from "./react/NoItems";
import { ContainerVisibilityContext, ParentComponent } from "./react/react_utils";
import { TypeWidgetProps } from "./type_widgets/type_widget";

/**
 * The note detail is in charge of rendering the content of a note, by determining its type (e.g. text, code) and using the appropriate view widget.
 *
 * Apart from that, it:
 * - Applies a full-height style depending on the content type (e.g. canvas notes).
 * - Focuses the content when switching tabs.
 * - Caches the note type elements based on what the user has accessed, in order to quickly load it again.
 * - Fixes the tree for launch bar configurations on mobile.
 * - Provides scripting events such as obtaining the active note detail widget, or note type widget.
 * - Printing and exporting to PDF.
 */
export default function NoteDetail() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { note, type, mime, noteContext, parentComponent } = useNoteInfo();
    const { ntxId, viewScope } = noteContext ?? {};
    const isFullHeight = checkFullHeight(noteContext, type);
    const fillsPane = checkFillsPane(noteContext, type);
    const hasEndMargin = !isFullHeight && !!type && !!TYPE_MAPPINGS[type].hasEndMargin;
    useParentClass(containerRef, "detail-full-height", isFullHeight);
    useParentClass(containerRef, "detail-fills-pane", fillsPane);
    useParentClass(containerRef, "detail-has-end-margin", hasEndMargin);
    const { noteTypesToRender, activeNoteType, loadingType } = useTypeWidgets(type, note);

    const props: TypeWidgetProps = {
        note: note!,
        viewScope,
        ntxId,
        parentComponent,
        noteContext
    };

    // Detect note type changes.
    useTriliumEvent("entitiesReloaded", async ({ loadResults }) => {
        if (!note) return;

        // we're detecting note type change on the note_detail level, but triggering the noteTypeMimeChanged
        // globally, so it also reaches widgets outside the note detail. But this means that the event can be generated multiple
        // times if the same note is open in several tabs.

        if (note.noteId
            && loadResults.isNoteReloaded(note.noteId, parentComponent.componentId)
            && (type !== (await getExtendedWidgetType(note, noteContext)) || mime !== note?.mime)) {
            // this needs to have a triggerEvent so that e.g., note type (not in the component subtree) is updated
            parentComponent.triggerEvent("noteTypeMimeChanged", { noteId: note.noteId });
        } else if (note.noteId && loadResults.isNoteContentReloaded(note.noteId, parentComponent.componentId)) {
            // probably incorrect event
            // calling this.refresh() is not enough since the event needs to be propagated to children as well
            // FIXME: create a separate event to force hierarchical refresh

            // this uses handleEvent to make sure that the ordinary content updates are propagated only in the subtree
            // to avoid the problem in #3365
            parentComponent.handleEvent("noteTypeMimeChanged", { noteId: note.noteId });
        } else {
            const attrs = loadResults.getAttributeRows();

            const label = attrs.find(
                (attr) =>
                    attr.type === "label" &&
                    ["readOnly", "autoReadOnlyDisabled", "cssClass", "displayRelations", "hideRelations"].includes(attr.name ?? "") &&
                    attributes.isAffecting(attr, note)
            );

            const relation = attrs.find((attr) => attr.type === "relation" && ["template", "inherit", "renderNote"]
                .includes(attr.name ?? "") && attributes.isAffecting(attr, note));

            if (note.noteId && (label || relation)) {
                // probably incorrect event
                // calling this.refresh() is not enough since the event needs to be propagated to children as well
                parentComponent.triggerEvent("noteTypeMimeChanged", { noteId: note.noteId });
            }
        }
    });

    // A focus requested while the note is still switching (e.g. right after creating it) reaches
    // a type widget that is hidden or not mounted yet, so it is sent again once the new one shows.
    const isTypeWidgetShown = !!note && note.noteId === noteContext?.noteId && !!type && activeNoteType === type;
    const requestDetailFocus = useDeferredDetailFocus(isTypeWidgetShown,
        (data) => parentComponent.handleEventInChildren("focusOnDetail", data));
    useTriliumEvent("focusOnDetail", (data) => {
        if (data.ntxId === ntxId) requestDetailFocus(data);
    });

    // Automatically focus the editor.
    useTriliumEvent("activeNoteChanged", ({ ntxId: eventNtxId }) => {
        if (eventNtxId != ntxId) return;
        const noteSplit = parentComponent.$widget[0].closest(".note-split");
        if (shouldFocusOnNoteChange(document.activeElement, noteSplit, isMobile())) {
            parentComponent.triggerCommand("focusOnDetail", { ntxId });
        }
    });

    // Handle toast notifications.
    useEffect(() => {
        const api = window.electronApi?.printing;
        if (!api) return;
        api.onPrintProgress(({ progress, action }) => {
            void import("./NoteDetailPrint").then(({ showPrintToast }) => {
                showPrintToast(action as "printing" | "exporting_pdf", progress);
            });
        });
        api.onPrintDone((printReport, liveJobId) => {
            void import("./NoteDetailPrint").then(({ finishElectronPrint }) => {
                finishElectronPrint(printReport as PrintReport, liveJobId);
            });
        });
        return () => {
            api.removePrintListeners();
        };
    }, [note]);

    useTriliumEvent("executeInActiveNoteDetailWidget", ({ callback }) => {
        if (!noteContext?.isActive()) return;
        callback(parentComponent);
    });

    useTriliumEvent("executeWithTypeWidget", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId || !activeNoteType || !containerRef.current) return;

        const classNameToSearch = TYPE_MAPPINGS[activeNoteType].className;
        const componentEl = containerRef.current.querySelector<HTMLElement>(`.${classNameToSearch}`);
        if (!componentEl) return;

        const component = glob.getComponentByEl(componentEl);
        resolve(component);
    });

    useTriliumEvent("printActiveNote", ({ ntxId }) => {
        if (!noteContext?.isCommandTarget(ntxId) || !note) return;

        // PDF printing is handled by the PDF viewer's own print mechanism.
        if (note.type === "file" && note.mime === "application/pdf") return;

        void import("./NoteDetailPrint").then(({ printNote }) => {
            printNote(note, noteContext, containerRef.current, type);
        });
    });

    return (
        <div
            ref={containerRef}
            class={clsx("component note-detail", {
                "full-height": isFullHeight,
                "fills-pane": fillsPane
            })}
        >
            {Object.entries(noteTypesToRender).map(([ itemType, Element ]) => {
                return <NoteDetailWrapper
                    Element={Element}
                    key={itemType}
                    type={itemType as ExtendedNoteType}
                    isVisible={type === itemType}
                    isFullHeight={isFullHeight}
                    props={props}
                />;
            })}

            <NoteDetailLoadingOverlay noteContext={noteContext} isLoadingWidget={!!loadingType} />
        </div>
    );
}

/**
 * Whether a note opened in a split focuses its editor, as when switching tabs: not while the note
 * tree or the split itself (its title or detail) has focus, and never on a phone, where focusing
 * the editor brings up the keyboard over the note just opened from the tree.
 */
export function shouldFocusOnNoteChange(
    focused: Element | null, noteSplit: Element | null | undefined, mobile: boolean
) {
    if (mobile) return false;
    return !focused?.classList.contains("fancytree-title") && !noteSplit?.contains(focused);
}

/**
 * Holds a `focusOnDetail` that arrives while `isReady` is false and calls `replay` with it once
 * `isReady` turns true. A request made while ready is left to the widgets that already received it.
 */
export function useDeferredDetailFocus(isReady: boolean, replay: (data: EventData<"focusOnDetail">) => void) {
    const pendingRef = useRef<EventData<"focusOnDetail"> | undefined>(undefined);
    const replayRef = useRef(replay);
    replayRef.current = replay;

    useEffect(() => {
        const pending = pendingRef.current;
        if (!isReady || !pending) return;
        pendingRef.current = undefined;
        replayRef.current(pending);
    }, [ isReady ]);

    return useCallback((data: EventData<"focusOnDetail">) => {
        if (!isReady) pendingRef.current = data;
    }, [ isReady ]);
}

/**
 * Wraps a single note type widget, in order to keep it in the DOM even after the user has switched away to another note type. This allows faster loading of the same note type again. The properties are cached, so that they are updated only
 * while the widget is visible, to avoid rendering in the background. When not visible, the DOM element is simply hidden.
 */
export function NoteDetailWrapper({ Element, type, isVisible, isFullHeight, props }: { Element: TypeWidget, type: ExtendedNoteType, isVisible: boolean, isFullHeight: boolean, props: TypeWidgetProps }) {
    // False when an enclosing dialog (e.g. the quick-edit popup) is hidden but kept in the DOM, so a widget
    // there is told it isn't displayed even though it's the context's current type — letting a media player
    // inside a closed popup stop, just like one in a navigated-away tab.
    const containerVisible = useContext(ContainerVisibilityContext);
    const [ cachedProps, setCachedProps ] = useState(props);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const eventGate = useTypeWidgetEventGate(isVisible && containerVisible);
    useLegacyComponentElement(wrapperRef, eventGate);

    useEffect(() => {
        if (isVisible) {
            setCachedProps(props);
        }
        // When not visible, keep the old props to avoid re-rendering in the background.
    }, [ props, isVisible ]);

    const typeMapping = TYPE_MAPPINGS[type];
    const shownNoteId = cachedProps.note?.noteId;
    const shownRef = useRef({ isVisible, shownNoteId, noteContext: cachedProps.noteContext });
    shownRef.current = { isVisible, shownNoteId, noteContext: cachedProps.noteContext };
    /** The note whose content the widget last reported drawn, kept while it is hidden. */
    const drawnNoteIdRef = useRef<string | undefined>(undefined);
    const reportContentShown = useCallback(() => {
        const { isVisible, shownNoteId, noteContext } = shownRef.current;
        drawnNoteIdRef.current = shownNoteId;
        if (isVisible && shownNoteId) {
            noteContext?.setContextData("typeWidgetNote", { noteId: shownNoteId });
        }
    }, []);

    // Runs after the widget's own effects, so a widget that loads its content (`useNoteBlob()`)
    // has already reported `contentLoad` as loading. A widget that draws its content later calls
    // `onContentShown` itself, except when it is shown again with the note it already holds.
    useEffect(() => {
        if (!typeMapping.reportsContentShown || drawnNoteIdRef.current === shownNoteId) {
            reportContentShown();
        }
    }, [ isVisible, shownNoteId, cachedProps.noteContext, typeMapping, reportContentShown ]);

    // This widget stays mounted (just hidden) when the user switches note type —
    // e.g. read-only ↔ editable text — and also when an enclosing dialog such as the quick-edit
    // popup is closed but kept in the DOM. A hidden but still-mounted embedded player keeps playing
    // audio/video in the background, so stop it in either case.
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (wrapper && (!isVisible || !containerVisible)) {
            void import("../services/media_playback").then(({ stopBackgroundMedia }) => stopBackgroundMedia(wrapper));
        }
    }, [ isVisible, containerVisible ]);

    return (
        <div
            ref={wrapperRef}
            className={`${typeMapping.className} ${typeMapping.printable ? "note-detail-printable" : ""} ${isVisible ? "visible" : "hidden-ext"}`}
            style={{
                height: isFullHeight ? "100%" : ""
            }}
        >
            <ParentComponent.Provider value={eventGate}>
                <Element
                    {...cachedProps}
                    parentComponent={eventGate}
                    isVisible={isVisible && containerVisible}
                    onContentShown={reportContentShown}
                />
            </ParentComponent.Provider>
        </div>
    );
}

/**
 * Events that reach a type widget while `NoteDetailWrapper` hides it. They keep its state current
 * for when it is displayed again; every other event is meant for the displayed type widget only.
 */
const EVENTS_FOR_HIDDEN_TYPE_WIDGETS = new Set<EventNames>([
    "entitiesReloaded", "frocaReloaded", "refreshEmbeddedNote", "searchRefreshed", "apiLogMessages",
    "sqlQueryResults",
    "themeChanged", "protectedSessionStarted", "readOnlyTemporarilyDisabled", "contextDataChanged",
    "setNoteContext", "activeContextChanged", "activeNoteChanged", "hoistedNoteChanged",
    "noteSwitched", "noteSwitchedAndActivated", "beforeNoteSwitch", "noteTypeMimeChanged",
    "beforeNoteContextRemove"
]);

/**
 * Stands between `NoteDetail`'s component and one cached type widget, and stops the events in
 * `handleEventInChildren()` that a hidden type widget must not answer. It takes the host's
 * `componentId`, so the type widget's saves still count as `NoteDetail`'s own.
 */
class TypeWidgetEventGate extends Component {
    isDisplayed = true;

    constructor(host: Component | null) {
        super();
        if (host) {
            this.componentId = host.componentId;
            this.setParent(host);
        }
    }

    handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>) {
        if (!this.isDisplayed && !EVENTS_FOR_HIDDEN_TYPE_WIDGETS.has(name)) return null;
        return super.handleEventInChildren(name, data);
    }
}

function useTypeWidgetEventGate(isDisplayed: boolean) {
    const host = useContext(ParentComponent);
    const gate = useMemo(() => new TypeWidgetEventGate(host), [ host ]);
    gate.isDisplayed = isDisplayed;

    useLayoutEffect(() => {
        if (!host) return;
        host.child(gate);
        return () => host.removeChild(gate);
    }, [ host, gate ]);

    return gate;
}

/**
 * Covers the note detail while the note's content is being fetched, so the user is not left
 * looking at (and typing into) the previous note's content when the blob is slow to arrive.
 *
 * Driven by the `contentLoad` context data published from `useNoteInfo` (type resolution,
 * which fetches the content for the auto-readonly check) and `useNoteBlob` (the editors'
 * own content fetch), and paced by {@link useDelayedVisibility}: fast loads never flash it,
 * slow loads fade it in, and loads stuck past the stall threshold (or failed outright)
 * offer a retry.
 */
function NoteDetailLoadingOverlay({ noteContext, isLoadingWidget }: {
    noteContext: NoteContext | null | undefined,
    /** Whether the module of the note's type widget is still being imported. */
    isLoadingWidget: boolean
}) {
    const contentLoad = useGetContextDataFrom(noteContext, "contentLoad");
    const phase = useDelayedVisibility(contentLoad?.state === "loading" || isLoadingWidget);
    const isError = contentLoad?.state === "error";

    if (!isError && phase === "hidden") {
        return null;
    }

    return (
        <div className="note-detail-loading-overlay">
            {isError ? (
                <NoItems icon="bx bx-error-circle" text={t("note_detail.content_load_error")}>
                    <Button text={t("note_detail.content_load_retry")} onClick={() => contentLoad?.retry()} />
                </NoItems>
            ) : phase === "stalled" ? (
                <NoItems icon="bx bx-loader-alt bx-spin" text={t("note_detail.content_load_stalled")}>
                    <Button text={t("note_detail.content_load_retry")} onClick={() => contentLoad?.retry()} />
                </NoItems>
            ) : (
                <Icon icon="bx bx-loader-alt bx-spin" />
            )}
        </div>
    );
}

/**
 * Imports the type widget of `type` and keeps every widget imported so far, so that switching
 * back to a type shows its widget at once. `loadingType` is the type whose widget is being
 * imported, until the import settles, whether it yields a widget or not; it is derived in the
 * render that changes `type`, so the loading overlay never sees a frame without it. A failed
 * import is tried again for the next note.
 *
 * Exported for testing.
 */
export function useTypeWidgets(
    type: ExtendedNoteType | undefined,
    note?: FNote | null,
    load: (type: ExtendedNoteType) => Promise<TypeWidget | null> = getCorrespondingWidget
) {
    const [ noteTypesToRender, setNoteTypesToRender ] = useState<{ [ key in ExtendedNoteType ]?: TypeWidget }>({});
    const [ activeNoteType, setActiveNoteType ] = useState<ExtendedNoteType>();
    /** The type whose last import settled, with a widget or without one. */
    const [ settledType, setSettledType ] = useState<ExtendedNoteType>();
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (!type) return;
        const requestId = ++requestIdRef.current;

        if (noteTypesToRender[type]) {
            setActiveNoteType(type);
            return;
        }

        setSettledType(undefined);
        load(type)
            .then((widget) => {
                if (!widget || requestId !== requestIdRef.current) return;
                setNoteTypesToRender((prev) => ({ ...prev, [type]: widget }));
                setActiveNoteType(type);
            })
            .catch((e: unknown) => console.error(`Unable to load the widget of the note type ${type}`, e))
            .finally(() => {
                if (requestId === requestIdRef.current) setSettledType(type);
            });
    }, [ type, note, noteTypesToRender, load ]);

    const loadingType = type && !noteTypesToRender[type] && settledType !== type ? type : undefined;
    return { noteTypesToRender, activeNoteType, loadingType };
}

/**
 * Manages both note changes and changes to the widget type, which are asynchronous.
 *
 * Exported for testing.
 */
export function useNoteInfo() {
    const { note: actualNote, noteContext, parentComponent } = useNoteContext();
    const [ note, setNote ] = useState<FNote | null | undefined>();
    const [ type, setType ] = useState<ExtendedNoteType>();
    const [ mime, setMime ] = useState<string>();
    const refreshIdRef = useRef(0);

    function refresh() {
        const refreshId = ++refreshIdRef.current;

        // The type resolution below can take a while (the auto-readonly check of
        // getExtendedWidgetType fetches the note's content), during which the previously
        // rendered note stays visible — cover it with the content-loading overlay.
        if (actualNote) {
            noteContext?.setContextData("contentLoad", { state: "loading", retry: refresh });
        }

        getExtendedWidgetType(actualNote, noteContext).then(type => {
            if (refreshId !== refreshIdRef.current) return;
            setNote(actualNote);
            setType(type);
            setMime(actualNote?.mime);
            if (actualNote) {
                noteContext?.setContextData("contentLoad", { state: "loaded", retry: refresh });
            }
        });
    }

    useEffect(refresh, [ actualNote, noteContext, noteContext?.viewScope ]);
    useTriliumEvent("readOnlyTemporarilyDisabled", ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext?.ntxId !== noteContext?.ntxId) return;
        refresh();
    });
    useTriliumEvent("noteTypeMimeChanged", ({ noteId }) => {
        if (noteId === actualNote?.noteId) refresh();
    });

    return { note, type, mime, noteContext, parentComponent };
}

async function getCorrespondingWidget(type: ExtendedNoteType): Promise<null | TypeWidget> {
    const correspondingType = TYPE_MAPPINGS[type].view;
    if (!correspondingType) return null;

    const result = await correspondingType();

    if ("default" in result) {
        return result.default;
    } else if (isValidElement(result)) {
        // Direct VNode provided.
        return result;
    }
    return result;

}

export async function getExtendedWidgetType(note: FNote | null | undefined, noteContext: NoteContext | undefined): Promise<ExtendedNoteType | undefined> {
    if (!noteContext) return undefined;
    if (!note) {
        // If the note is null, then it's a new tab. If it's undefined, then it's not loaded yet.
        return note === null ? "empty" : undefined;
    }

    const type = note.type;
    let resultingType: ExtendedNoteType;

    if (noteContext?.viewScope?.viewMode === "source") {
        resultingType = "readOnlyCode";
    } else if (noteContext.viewScope?.viewMode === "attachments") {
        resultingType = noteContext.viewScope.attachmentId ? "attachmentDetail" : "attachmentList";
    } else if (noteContext.viewScope?.viewMode === "note-map") {
        resultingType = "noteMap";
    } else if (type === "text" && (await noteContext?.isReadOnly())) {
        resultingType = "readOnlyText";
    } else if (note.isTriliumSqlite()) {
        resultingType = "sqlConsole";
    } else if (note.isMarkdown()) {
        resultingType = "markdown";
    } else if (note.isIconPack()) {
        resultingType = "iconPack";
    } else if (type === "code" && (await noteContext?.isReadOnly())) {
        resultingType = "readOnlyCode";
    } else if (type === "text") {
        resultingType = "editableText";
    } else if (type === "code") {
        resultingType = "editableCode";
    } else if (type === "launcher") {
        resultingType = "doc";
    } else {
        resultingType = type;
    }

    // A note whose blob was withheld by the sync server (device blob size limit) has empty content;
    // route it to a placeholder rather than a content widget. This also prevents an editor from
    // saving the empty stub back over the real content on the server. Only content-backed types are
    // checked, so blobless notes (docs, launchers, books) don't trigger a needless blob fetch; the
    // fetch itself is froca-cached and coalesced with the render's own blob load.
    //
    // The froca-cache check skips the fetch during delete teardown: when the active note is deleted, a
    // re-render can still run with the (batched, not-yet-cleared) stale FNote reference. froca_updater
    // removes the note from the cache before emitting entitiesReloaded, so a missing cache entry means the
    // note is gone — don't fetch a blob for a note that no longer exists. (The 404 that surfaced this is
    // actually issued by the still-cached modal-close render racing the delete; froca.getBlob's
    // silentNotFound handling is what keeps that one quiet. This check just avoids the redundant later fetch.)
    const reason = await getUnavailableReason(note, BLOB_BACKED_TYPES.has(resultingType));
    return reason ?? resultingType;
}

/**
 * Why the content of `entity` cannot be shown on this device: a protected note or attachment
 * outside a protected session, or, when `isBlobBacked`, a blob that the sync server withheld.
 * `null` when it can.
 */
export async function getUnavailableReason(
    entity: FNote | FAttachment, isBlobBacked = true
): Promise<"protectedSession" | "blobStub" | null> {
    if (entity.isProtected && !protected_session_holder.isProtectedSessionAvailable()) {
        return "protectedSession";
    }
    const isCached = "attachmentId" in entity || !!froca.getNoteFromCache(entity.noteId);
    if (isBlobBacked && isCached) {
        const blob = await entity.getBlob();
        if (blob?.isStubbed) {
            return "blobStub";
        }
    }
    return null;
}

// Extended note types that render or edit a note's blob content, and so must fall back to the
// "blobStub" placeholder when that content was not synced to this device.
const BLOB_BACKED_TYPES = new Set<ExtendedNoteType>([
    "editableText", "readOnlyText", "editableCode", "readOnlyCode", "markdown",
    "file", "image", "mermaid", "canvas", "mindMap", "render", "spreadsheet"
]);

export function checkFullHeight(noteContext: NoteContext | undefined, type: ExtendedNoteType | undefined) {
    if (!noteContext) return false;

    // https://github.com/zadam/trilium/issues/2522
    const isBackendNote = noteContext?.noteId === "_backendLog";
    const isFullHeightNoteType = type && TYPE_MAPPINGS[type].isFullHeight;

    // Allow vertical centering when there are no results.
    if (type === "book" &&
        [ "grid", "list" ].includes(noteContext.note?.getLabelValue("viewType") ?? "grid") &&
        !noteContext.note?.hasChildren()) {
        return true;
    }

    return (!noteContext?.hasNoteList() && isFullHeightNoteType)
        || noteContext?.viewScope?.viewMode === "attachments"
        || isBackendNote;
}

/** Whether the note's page lays itself out across the pane and scrolls inside itself. */
export function checkFillsPane(
    noteContext: NoteContext | undefined, type: ExtendedNoteType | undefined
) {
    return type === "contentWidget" && noteContext?.noteId === "_spaceUsage";
}
