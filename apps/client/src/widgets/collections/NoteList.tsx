import "./NoteList.css";

import { WebSocketMessage } from "@triliumnext/commons";
import { VNode } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import type { PrintReport } from "../../print";
import froca from "../../services/froca";
import { subscribeToMessages, unsubscribeToMessage as unsubscribeFromMessage } from "../../services/ws";
import { useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent } from "../react/hooks";
import { allViewTypes, ViewModeMedia, ViewModeProps, ViewTypeOptions } from "./interface";
import ViewModeStorage, { type ViewModeStorageType } from "./view_mode_storage";

interface NoteListProps {
    note: FNote | null | undefined;
    notePath: string | null | undefined;
    highlightedTokens?: string[] | null;
    /** if set to `true` then only collection-type views are displayed such as geo-map and the calendar. The original book types grid and list will be ignored. */
    displayOnlyCollections?: boolean;
    isEnabled: boolean;
    ntxId: string | null | undefined;
    media: ViewModeMedia;
    viewType: ViewTypeOptions | undefined;
    onReady?: (data: PrintReport) => void;
    onProgressChanged?(progress: number): void;
}

type LazyLoadedComponent = ((props: ViewModeProps<any>) => VNode<any> | undefined);
const ViewComponents: Record<ViewTypeOptions, { normal: LazyLoadedComponent, print?: LazyLoadedComponent }> = {
    list: {
        normal: lazy(() => import("./legacy/ListOrGridView.js").then(i => i.ListView)),
        print: lazy(() => import("./legacy/ListPrintView.js").then(i => i.ListPrintView))
    },
    grid: {
        normal: lazy(() => import("./legacy/ListOrGridView.js").then(i => i.GridView)),
    },
    geoMap: {
        normal: lazy(() => import("./geomap/index.js")),
    },
    calendar: {
        normal: lazy(() => import("./calendar/index.js"))
    },
    table: {
        normal: lazy(() => import("./table/index.js")),
        print: lazy(() => import("./table/TablePrintView.js"))
    },
    board: {
        normal: lazy(() => import("./board/index.js"))
    },
    presentation: {
        normal: lazy(() => import("./presentation/index.js"))
    }
};

export default function NoteList(props: Pick<NoteListProps, "displayOnlyCollections" | "media" | "onReady" | "onProgressChanged">) {
    const { note, noteContext, notePath, ntxId, viewScope } = useNoteContext();
    const viewType = useNoteViewType(note);
    const noteType = useNoteProperty(note, "type");
    const [ enabled, setEnabled ] = useState(noteContext?.hasNoteList());
    useEffect(() => {
        setEnabled(noteContext?.hasNoteList());
    }, [ note, noteContext, viewType, viewScope?.viewMode, noteType ]);
    return <CustomNoteList viewType={viewType} note={note} isEnabled={!!enabled} notePath={notePath} ntxId={ntxId} {...props} />;
}

export function SearchNoteList(props: Omit<NoteListProps, "isEnabled" | "viewType">) {
    const viewType = useNoteViewType(props.note);
    return <CustomNoteList {...props} isEnabled={true} viewType={viewType} />;
}

export function CustomNoteList({ note, viewType, isEnabled: shouldEnable, notePath, highlightedTokens, displayOnlyCollections, ntxId, onReady, onProgressChanged, ...restProps }: NoteListProps) {
    const widgetRef = useRef<HTMLDivElement>(null);
    const noteIds = useNoteIds(shouldEnable ? note : null, viewType, ntxId);
    const isFullHeight = (viewType && viewType !== "list" && viewType !== "grid");
    const [ isIntersecting, setIsIntersecting ] = useState(false);
    const shouldRender = (isFullHeight || isIntersecting || note?.type === "book");
    const isEnabled = (note && shouldEnable && !!viewType && shouldRender);

    useEffect(() => {
        if (isFullHeight || displayOnlyCollections || note?.type === "book") {
            // Double role: no need to check if the note list is visible if the view is full-height or book, but also prevent legacy views if `displayOnlyCollections` is true.
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!isIntersecting) {
                    setIsIntersecting(entries[0].isIntersecting);
                    observer.disconnect();
                }
            },
            {
                rootMargin: "50px",
                threshold: 0.1
            }
        );

        // there seems to be a race condition on Firefox which triggers the observer only before the widget is visible
        // (intersection is false). https://github.com/zadam/trilium/issues/4165
        setTimeout(() => widgetRef.current && observer.observe(widgetRef.current), 10);
        return () => observer.disconnect();
    }, [ widgetRef, isFullHeight, displayOnlyCollections, note ]);

    // Preload the configuration.
    let props: ViewModeProps<any> | undefined | null = null;
    const viewModeConfig = useViewModeConfig(note, viewType);
    if (note && notePath && viewModeConfig) {
        props = {
            note, noteIds, notePath,
            highlightedTokens,
            viewConfig: viewModeConfig.config,
            saveConfig: viewModeConfig.storeFn,
            onReady: onReady ?? (() => {}),
            onProgressChanged: onProgressChanged ?? (() => {}),

            ...restProps
        };
    }

    const ComponentToRender = viewType && props && isEnabled && (
        props.media === "print" ? ViewComponents[viewType].print : ViewComponents[viewType].normal
    );

    return (
        <div ref={widgetRef} className={`note-list-widget component ${isFullHeight && isEnabled ? "full-height" : ""}`}>
            {ComponentToRender && props && (
                <div className="note-list-widget-content">
                    <Suspense fallback="">
                        <ComponentToRender {...props} />
                    </Suspense>
                </div>
            )}
        </div>
    );
}

export function useNoteViewType(note?: FNote | null): ViewTypeOptions | undefined {
    const [ viewType ] = useNoteLabel(note, "viewType");

    if (!note) {
        return undefined;
    } else if (!(allViewTypes as readonly string[]).includes(viewType || "")) {
        // when not explicitly set, decide based on the note type
        return note.type === "search" ? "list" : "grid";
    }
    return viewType as ViewTypeOptions;

}

export function useNoteIds(note: FNote | null | undefined, viewType: ViewTypeOptions | undefined, ntxId: string | null | undefined) {
    const [ noteIds, setNoteIds ] = useState<string[]>([]);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const directChildrenOnly = (viewType === "list" || viewType === "grid" || viewType === "table" || note?.type === "search");

    async function refreshNoteIds() {
        if (!note) {
            setNoteIds([]);
        } else {
            setNoteIds(await getNoteIds(note));
        }
    }

    async function getNoteIds(note: FNote) {
        if (directChildrenOnly) {
            return await note.getChildNoteIdsWithArchiveFiltering(includeArchived);
        }
        return await note.getSubtreeNoteIds(includeArchived);

    }

    // Refresh on note switch.
    useEffect(() => {
        refreshNoteIds();
    }, [ note, includeArchived, directChildrenOnly ]);

    // Refresh on alterations to the note subtree.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().some(branch =>
            branch.parentNoteId === note.noteId
                || noteIds.includes(branch.parentNoteId ?? ""))
            || loadResults.getAttributeRows().some(attr => attr.name === "archived" && attr.noteId && noteIds.includes(attr.noteId))
        ) {
            refreshNoteIds();
        }
    });

    // Refresh on search.
    useTriliumEvent("searchRefreshed", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        refreshNoteIds();
    });

    // Refresh on import.
    useEffect(() => {
        async function onImport(message: WebSocketMessage) {
            if (!("taskType" in message) || message.taskType !== "importNotes" || message.type !== "taskSucceeded") return;
            const { parentNoteId, importedNoteId } = message.result;
            if (!parentNoteId || !importedNoteId) return;
            if (importedNoteId && (parentNoteId === note?.noteId || noteIds.includes(parentNoteId))) {
                const importedNote = await froca.getNote(importedNoteId);
                if (!importedNote) return;
                setNoteIds([
                    ...noteIds,
                    ...await getNoteIds(importedNote),
                    importedNoteId
                ]);
            }
        }

        subscribeToMessages(onImport);
        return () => unsubscribeFromMessage(onImport);
    }, [ note, noteIds, setNoteIds ]);

    return noteIds;
}

export function useViewModeConfig<T extends object>(note: FNote | null | undefined, viewType: ViewModeStorageType | undefined) {
    const [ viewConfig, setViewConfig ] = useState<{
        config: T | undefined;
        storeFn: (data: T) => void;
        note: FNote;
    }>();

    useEffect(() => {
        if (!note || !viewType) return;
        setViewConfig(undefined);
        const viewStorage = new ViewModeStorage<T>(note, viewType);
        viewStorage.restore().then(config => {
            const storeFn = (config: T) => {
                setViewConfig({ note, config, storeFn });
                viewStorage.store(config);
            };
            setViewConfig({ note, config, storeFn });
        });
    }, [ note, viewType ]);

    // Only expose config for the current note, avoid leaking notes when switching between them.
    if (viewConfig?.note !== note) return undefined;
    return viewConfig;
}
