import { BacklinkCountResponse, BacklinksResponse, SaveSqlConsoleResponse } from "@triliumnext/commons";
import { VNode } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext, { EventData, EventNames } from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { isExperimentalFeatureEnabled } from "../services/experimental_features";
import froca from "../services/froca";
import { t } from "../services/i18n";
import { copyImageReferenceToClipboard } from "../services/image";
import { getHelpUrlForNote } from "../services/in_app_help";
import LoadResults from "../services/load_results";
import server from "../services/server";
import toast from "../services/toast";
import tree from "../services/tree";
import { createImageSrcUrl, openInAppHelpFromUrl } from "../services/utils";
import { ViewTypeOptions } from "./collections/interface";
import ActionButton, { ActionButtonProps } from "./react/ActionButton";
import { useIsNoteReadOnly, useNoteLabelBoolean, useTriliumEvent, useTriliumOption, useWindowSize } from "./react/hooks";
import NoteLink from "./react/NoteLink";
import RawHtml from "./react/RawHtml";

export interface FloatingButtonContext {
    parentComponent: Component;
    note: FNote;
    noteContext: NoteContext;
    isDefaultViewMode: boolean;
    isReadOnly: boolean;
    /** Shorthand for triggering an event from the parent component. The `ntxId` is automatically handled for convenience. */
    triggerEvent<T extends EventNames>(name: T, data?: Omit<EventData<T>, "ntxId">): void;
    viewType?: ViewTypeOptions | null;
}

function FloatingButton({ className, ...props }: ActionButtonProps) {
    return <ActionButton
        className={`floating-button ${className ?? ""}`}
        noIconActionClass
        {...props}
    />;
}

export type FloatingButtonsList = ((context: FloatingButtonContext) => false | VNode)[];

export const DESKTOP_FLOATING_BUTTONS: FloatingButtonsList = [
    RefreshBackendLogButton,
    SwitchSplitOrientationButton,
    ToggleReadOnlyButton,
    EditButton,
    ShowTocWidgetButton,
    ShowHighlightsListWidgetButton,
    RunActiveNoteButton,
    OpenTriliumApiDocsButton,
    SaveToNoteButton,
    RelationMapButtons,
    GeoMapButtons,
    CopyImageReferenceButton,
    ExportImageButtons,
    InAppHelpButton,
    Backlinks
];

export const MOBILE_FLOATING_BUTTONS: FloatingButtonsList = [
    RefreshBackendLogButton,
    EditButton,
    RelationMapButtons,
    ExportImageButtons,
    Backlinks
];

/**
 * Floating buttons that should be hidden in popup editor (Quick edit).
 */
export const POPUP_HIDDEN_FLOATING_BUTTONS: FloatingButtonsList = [
    InAppHelpButton,
    ToggleReadOnlyButton
];

function RefreshBackendLogButton({ note, parentComponent, noteContext, isDefaultViewMode }: FloatingButtonContext) {
    const isEnabled = (note.noteId === "_backendLog" || note.type === "render") && isDefaultViewMode;
    return isEnabled && <FloatingButton
        text={t("backend_log.refresh")}
        icon="bx bx-refresh"
        onClick={() => parentComponent.triggerEvent("refreshData", { ntxId: noteContext.ntxId })}
    />;
}

function SwitchSplitOrientationButton({ note, isReadOnly, isDefaultViewMode }: FloatingButtonContext) {
    const isEnabled = note.type === "mermaid" && note.isContentAvailable() && !isReadOnly && isDefaultViewMode;
    const [ splitEditorOrientation, setSplitEditorOrientation ] = useTriliumOption("splitEditorOrientation");
    const upcomingOrientation = splitEditorOrientation === "horizontal" ? "vertical" : "horizontal";

    return isEnabled && <FloatingButton
        text={upcomingOrientation === "vertical" ? t("switch_layout_button.title_vertical") : t("switch_layout_button.title_horizontal")}
        icon={upcomingOrientation === "vertical" ? "bx bxs-dock-bottom" : "bx bxs-dock-left"}
        onClick={() => setSplitEditorOrientation(upcomingOrientation)}
    />;
}

function ToggleReadOnlyButton({ note, viewType, isDefaultViewMode }: FloatingButtonContext) {
    const [ isReadOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const isEnabled = ([ "mermaid", "mindMap", "canvas" ].includes(note.type) || viewType === "geoMap")
            && note.isContentAvailable() && isDefaultViewMode;

    return isEnabled && <FloatingButton
        text={isReadOnly ? t("toggle_read_only_button.unlock-editing") : t("toggle_read_only_button.lock-editing")}
        icon={isReadOnly ? "bx bx-lock-open-alt" : "bx bx-lock-alt"}
        onClick={() => setReadOnly(!isReadOnly)}
    />;
}

function EditButton({ note, noteContext }: FloatingButtonContext) {
    const [animationClass, setAnimationClass] = useState("");
    const {isReadOnly, enableEditing} = useIsNoteReadOnly(note, noteContext);

    const isReadOnlyInfoBarDismissed = false; // TODO

    useEffect(() => {
        if (isReadOnly) {
            setAnimationClass("bx-tada bx-lg");
            setTimeout(() => {
                setAnimationClass("");
            }, 1700);
        }
    }, [ isReadOnly ]);

    return !!isReadOnly && isReadOnlyInfoBarDismissed && <FloatingButton
        text={t("edit_button.edit_this_note")}
        icon="bx bx-pencil"
        className={animationClass}
        onClick={() => enableEditing()}
    />;
}

function ShowTocWidgetButton({ note, noteContext, isDefaultViewMode }: FloatingButtonContext) {
    const [ isEnabled, setIsEnabled ] = useState(false);
    useTriliumEvent("reEvaluateTocWidgetVisibility", () => {
        setIsEnabled(note.type === "text" && isDefaultViewMode && !!noteContext.viewScope?.tocTemporarilyHidden);
    });

    return isEnabled && <FloatingButton
        text={t("show_toc_widget_button.show_toc")}
        icon="bx bx-spreadsheet bx-rotate-180"
        onClick={() => {
            if (noteContext?.viewScope && noteContext.noteId) {
                noteContext.viewScope.tocTemporarilyHidden = false;
                appContext.triggerEvent("showTocWidget", { noteId: noteContext.noteId });
            }
        }}
    />;
}

function ShowHighlightsListWidgetButton({ note, noteContext, isDefaultViewMode }: FloatingButtonContext) {
    const [ isEnabled, setIsEnabled ] = useState(false);
    useTriliumEvent("reEvaluateHighlightsListWidgetVisibility", () => {
        setIsEnabled(note.type === "text" && isDefaultViewMode && !!noteContext.viewScope?.highlightsListTemporarilyHidden);
    });

    return isEnabled && <FloatingButton
        text={t("show_highlights_list_widget_button.show_highlights_list")}
        icon="bx bx-bookmarks"
        onClick={() => {
            if (noteContext?.viewScope && noteContext.noteId) {
                noteContext.viewScope.highlightsListTemporarilyHidden = false;
                appContext.triggerEvent("showHighlightsListWidget", { noteId: noteContext.noteId });
            }
        }}
    />;
}

function RunActiveNoteButton({ note }: FloatingButtonContext) {
    const isEnabled = (note.mime.startsWith("application/javascript") || note.mime === "text/x-sqlite;schema=trilium");
    return isEnabled && <FloatingButton
        icon="bx bx-play"
        text={t("code_buttons.execute_button_title")}
        triggerCommand="runActiveNote"
    />;
}

function OpenTriliumApiDocsButton({ note }: FloatingButtonContext) {
    const isEnabled = note.mime.startsWith("application/javascript;env=");
    return isEnabled && <FloatingButton
        icon="bx bx-help-circle"
        text={t("code_buttons.trilium_api_docs_button_title")}
        onClick={() => openInAppHelpFromUrl(note.mime.endsWith("frontend") ? "Q2z6av6JZVWm" : "MEtfsqa5VwNi")}
    />;
}

function SaveToNoteButton({ note }: FloatingButtonContext) {
    const isEnabled = note.mime === "text/x-sqlite;schema=trilium" && note.isHiddenCompletely();
    return isEnabled && <FloatingButton
        icon="bx bx-save"
        text={t("code_buttons.save_to_note_button_title")}
        onClick={buildSaveSqlToNoteHandler(note)}
    />;
}

export function buildSaveSqlToNoteHandler(note: FNote) {
    return async (e: MouseEvent) => {
        e.preventDefault();
        const { notePath } = await server.post<SaveSqlConsoleResponse>("special-notes/save-sql-console", { sqlConsoleNoteId: note.noteId });
        if (notePath) {
            toast.showMessage(t("code_buttons.sql_console_saved_message", { "note_path": await tree.getNotePathTitle(notePath) }));
            // TODO: This hangs the navigation, for some reason.
            //await ws.waitForMaxKnownEntityChangeId();
            await appContext.tabManager.getActiveContext()?.setNote(notePath);
        }
    };
}

function RelationMapButtons({ note, isDefaultViewMode, triggerEvent }: FloatingButtonContext) {
    const isEnabled = (note.type === "relationMap" && isDefaultViewMode);
    return isEnabled && (
        <>
            <FloatingButton
                icon="bx bx-folder-plus"
                text={t("relation_map_buttons.create_child_note_title")}
                onClick={() => triggerEvent("relationMapCreateChildNote")}
            />

            <FloatingButton
                icon="bx bx-crop"
                text={t("relation_map_buttons.reset_pan_zoom_title")}
                onClick={() => triggerEvent("relationMapResetPanZoom")}
            />

            <div className="btn-group">
                <FloatingButton
                    icon="bx bx-zoom-in"
                    text={t("relation_map_buttons.zoom_in_title")}
                    onClick={() => triggerEvent("relationMapResetZoomIn")}
                />

                <FloatingButton
                    icon="bx bx-zoom-out"
                    text={t("relation_map_buttons.zoom_out_title")}
                    onClick={() => triggerEvent("relationMapResetZoomOut")}
                />
            </div>
        </>
    );
}

function GeoMapButtons({ triggerEvent, viewType, isReadOnly }: FloatingButtonContext) {
    const isEnabled = viewType === "geoMap" && !isReadOnly;
    return isEnabled && (
        <FloatingButton
            icon="bx bx-plus-circle"
            text={t("geo-map.create-child-note-title")}
            onClick={() => triggerEvent("geoMapCreateChildNote")}
        />
    );
}

function CopyImageReferenceButton({ note, isDefaultViewMode }: FloatingButtonContext) {
    const hiddenImageCopyRef = useRef<HTMLDivElement>(null);
    const isEnabled = (
        ["mermaid", "canvas", "mindMap", "image"].includes(note?.type ?? "")
        && note?.isContentAvailable() && isDefaultViewMode
    );

    return isEnabled && (
        <>
            <FloatingButton
                icon="bx bx-copy"
                text={t("copy_image_reference_button.button_title")}
                onClick={() => {
                    if (!hiddenImageCopyRef.current) return;
                    const imageEl = document.createElement("img");
                    imageEl.src = createImageSrcUrl(note);
                    hiddenImageCopyRef.current.replaceChildren(imageEl);
                    copyImageReferenceToClipboard($(hiddenImageCopyRef.current));
                    hiddenImageCopyRef.current.removeChild(imageEl);
                }}
            />

            <div ref={hiddenImageCopyRef} className="hidden-image-copy" style={{
                position: "absolute" // Take out of the the hidden image from flexbox to prevent the layout being affected
            }} />
        </>
    );
}

function ExportImageButtons({ note, triggerEvent, isDefaultViewMode }: FloatingButtonContext) {
    const isEnabled = ["mermaid", "mindMap"].includes(note?.type ?? "")
            && note?.isContentAvailable() && isDefaultViewMode;
    return isEnabled && (
        <>
            <FloatingButton
                icon="bx bxs-file-image"
                text={t("svg_export_button.button_title")}
                onClick={() => triggerEvent("exportSvg")}
            />

            <FloatingButton
                icon="bx bxs-file-png"
                text={t("png_export_button.button_title")}
                onClick={() => triggerEvent("exportPng")}
            />
        </>
    );
}

function InAppHelpButton({ note }: FloatingButtonContext) {
    const helpUrl = getHelpUrlForNote(note);
    const isEnabled = !!helpUrl;

    return isEnabled && (
        <FloatingButton
            icon="bx bx-help-circle"
            text={t("help-button.title")}
            onClick={() => helpUrl && openInAppHelpFromUrl(helpUrl)}
        />
    );
}

function Backlinks({ note, isDefaultViewMode }: FloatingButtonContext) {
    const [ popupOpen, setPopupOpen ] = useState(false);
    const backlinksContainerRef = useRef<HTMLDivElement>(null);
    const backlinkCount = useBacklinkCount(note, isDefaultViewMode);

    // Determine the max height of the container.
    const { windowHeight } = useWindowSize();
    useLayoutEffect(() => {
        const el = backlinksContainerRef.current;
        if (popupOpen && el) {
            const box = el.getBoundingClientRect();
            const maxHeight = windowHeight - box.top - 10;
            el.style.maxHeight = `${maxHeight}px`;
        }
    }, [ popupOpen, windowHeight ]);

    const isEnabled = isDefaultViewMode && backlinkCount > 0;
    return (isEnabled &&
        <div className="backlinks-widget has-overflow">
            <div
                className="backlinks-ticker"
                onClick={() => setPopupOpen(!popupOpen)}
            >
                <span className="backlinks-count">{t("zpetne_odkazy.backlink", { count: backlinkCount })}</span>
            </div>

            {popupOpen && (
                <div ref={backlinksContainerRef} className="backlinks-items dropdown-menu" style={{ display: "block" }}>
                    <BacklinksList note={note} />
                </div>
            )}
        </div>
    );
}

export function useBacklinkCount(note: FNote | null | undefined, isDefaultViewMode: boolean) {
    const [ backlinkCount, setBacklinkCount ] = useState(0);

    const refresh = useCallback(() => {
        if (!note || !isDefaultViewMode) return;

        server.get<BacklinkCountResponse>(`note-map/${note.noteId}/backlink-count`).then(resp => {
            setBacklinkCount(resp.count);
        });
    }, [ isDefaultViewMode, note ]);

    useEffect(() => refresh(), [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && needsRefresh(note, loadResults)) refresh();
    });

    return backlinkCount;
}

export function BacklinksList({ note }: { note: FNote }) {
    const [ backlinks, setBacklinks ] = useState<BacklinksResponse>([]);

    function refresh() {
        server.get<BacklinksResponse>(`note-map/${note.noteId}/backlinks`).then(async (backlinks) => {
            // prefetch all
            const noteIds = backlinks
                .filter(bl => "noteId" in bl)
                .map((bl) => bl.noteId);
            await froca.getNotes(noteIds);
            setBacklinks(backlinks);
        });
    }

    useEffect(() => refresh(), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (needsRefresh(note, loadResults)) refresh();
    });

    return backlinks.map(backlink => (
        <li>
            <NoteLink
                notePath={backlink.noteId}
                showNotePath showNoteIcon
                noPreview
            />

            {"relationName" in backlink ? (
                <p>{backlink.relationName}</p>
            ) : (
                backlink.excerpts.map(excerpt => (
                    <RawHtml html={excerpt} />
                ))
            )}
        </li>
    ));
}

function needsRefresh(note: FNote, loadResults: LoadResults) {
    return loadResults.getAttributeRows().some(attr =>
        attr.type === "relation" &&
        attributes.isAffecting(attr, note));
}
