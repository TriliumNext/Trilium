import { allViewTypes, ViewModeProps, ViewTypeOptions } from "./interface";
import { useNoteContext, useNoteLabel, useNoteLabelBoolean, useTriliumEvent } from "../react/hooks";
import FNote from "../../entities/fnote";
import "./NoteList.css";
import { ListView, GridView } from "./legacy/ListOrGridView";
import { useEffect, useRef, useState } from "preact/hooks";
import GeoView from "./geomap";
import ViewModeStorage from "./view_mode_storage";
import CalendarView from "./calendar";
import TableView from "./table";
import BoardView from "./board";
import { subscribeToMessages, unsubscribeToMessage as unsubscribeFromMessage } from "../../services/ws";
import { WebSocketMessage } from "@triliumnext/commons";
import froca from "../../services/froca";
import PresentationView from "./presentation";

interface NoteListProps {
    note: FNote | null | undefined;
    notePath: string | null | undefined;
    highlightedTokens?: string[] | null;
    /** if set to `true` then only collection-type views are displayed such as geo-map and the calendar. The original book types grid and list will be ignored. */
    displayOnlyCollections?: boolean;
    isEnabled: boolean;
    ntxId: string | null | undefined;
}

export default function NoteList<T extends object>(props: Pick<NoteListProps, "displayOnlyCollections">) {
    const { note, noteContext, notePath, ntxId } = useNoteContext();
    const isEnabled = noteContext?.hasNoteList();
    return <CustomNoteList note={note} isEnabled={!!isEnabled} notePath={notePath} ntxId={ntxId} {...props} />
}

export function SearchNoteList<T extends object>(props: Omit<NoteListProps, "isEnabled">) {
    return <CustomNoteList {...props} isEnabled={true} />
}

function CustomNoteList<T extends object>({ note, isEnabled: shouldEnable, notePath, highlightedTokens, displayOnlyCollections, ntxId }: NoteListProps) {
    const widgetRef = useRef<HTMLDivElement>(null);
    const viewType = useNoteViewType(note);
    const noteIds = useNoteIds(note, viewType, ntxId);
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
            viewConfig: viewModeConfig[0],
            saveConfig: viewModeConfig[1]
        }
    }

    return (
        <div ref={widgetRef} className={`note-list-widget component ${isFullHeight ? "full-height" : ""}`}>
            {props && isEnabled && (
                <div className="note-list-widget-content">
                    {getComponentByViewType(viewType, props)}
                </div>
            )}
        </div>
    );
}

function getComponentByViewType(viewType: ViewTypeOptions, props: ViewModeProps<any>) {
    switch (viewType) {
        case "list":
            return <ListView {...props} />;
        case "grid":
            return <GridView {...props} />;
        case "geoMap":
            return <GeoView {...props} />;
        case "calendar":
            return <CalendarView {...props} />
        case "table":
            return <TableView {...props} />
        case "board":
            return <BoardView {...props} />
        case "presentation":
            return <PresentationView {...props} />
    }
}

function useNoteViewType(note?: FNote | null): ViewTypeOptions | undefined {
    const [ viewType ] = useNoteLabel(note, "viewType");

    if (!note) {
        return undefined;
    } else if (!(allViewTypes as readonly string[]).includes(viewType || "")) {
        // when not explicitly set, decide based on the note type
        return note.type === "search" ? "list" : "grid";
    } else {
        return viewType as ViewTypeOptions;
    }
}

function useNoteIds(note: FNote | null | undefined, viewType: ViewTypeOptions | undefined, ntxId: string | null | undefined) {
    const [ noteIds, setNoteIds ] = useState<string[]>([]);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");

    async function refreshNoteIds() {
        if (!note) {
            setNoteIds([]);
        } else {
            setNoteIds(await getNoteIds(note));
        }
    }

    async function getNoteIds(note: FNote) {
        if (viewType === "list" || viewType === "grid") {
            return note.getChildNoteIds();
        } else {
            return await note.getSubtreeNoteIds(includeArchived);
        }
    }

    // Refresh on note switch.
    useEffect(() => { refreshNoteIds() }, [ note, includeArchived ]);

    // Refresh on alterations to the note subtree.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().some(branch =>
                branch.parentNoteId === note.noteId
                || noteIds.includes(branch.parentNoteId ?? ""))
            || loadResults.getAttributeRows().some(attr => attr.name === "archived" && attr.noteId && noteIds.includes(attr.noteId))
        ) {
            refreshNoteIds();
        }
    })

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
                ])
            }
        }

        subscribeToMessages(onImport);
        return () => unsubscribeFromMessage(onImport);
    }, [ note, noteIds, setNoteIds ])

    return noteIds;
}

function useViewModeConfig<T extends object>(note: FNote | null | undefined, viewType: ViewTypeOptions | undefined) {
    const [ viewConfig, setViewConfig ] = useState<[T | undefined, (data: T) => void]>();

    useEffect(() => {
        if (!note || !viewType) return;
        setViewConfig(undefined);
        const viewStorage = new ViewModeStorage<T>(note, viewType);
        viewStorage.restore().then(config => {
            const storeFn = (config: T) => {
                setViewConfig([ config, storeFn ]);
                viewStorage.store(config);
            };
            setViewConfig([ config, storeFn ]);
        });
    }, [ note, viewType ]);

    return viewConfig;
}
