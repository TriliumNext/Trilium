import { allViewTypes, ViewModeProps, ViewTypeOptions } from "./interface";
import { useNoteContext, useNoteLabel, useTriliumEvent } from "../react/hooks";
import FNote from "../../entities/fnote";
import "./NoteList.css";
import { ListView, GridView } from "./legacy/ListOrGridView";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import GeoView from "./geomap";
import ViewModeStorage from "../view_widgets/view_mode_storage";
import CalendarView from "./calendar";

interface NoteListProps<T extends object> {
    note?: FNote | null;
    /** if set to `true` then only collection-type views are displayed such as geo-map and the calendar. The original book types grid and list will be ignored. */
    displayOnlyCollections?: boolean;
    highlightedTokens?: string[] | null;
    viewStorage: ViewModeStorage<T>;
}

export default function NoteList<T extends object>({ note: providedNote, highlightedTokens, displayOnlyCollections }: NoteListProps<T>) {
    const widgetRef = useRef<HTMLDivElement>(null);
    const { note: contextNote, noteContext } = useNoteContext();
    const note = providedNote ?? contextNote;
    const viewType = useNoteViewType(note);
    const noteIds = useNoteIds(note, viewType);
    const isFullHeight = (viewType !== "list" && viewType !== "grid");
    const [ isIntersecting, setIsIntersecting ] = useState(false);
    const shouldRender = (isFullHeight || isIntersecting || note?.type === "book");
    const isEnabled = (note && noteContext?.hasNoteList() && !!viewType && shouldRender);

    useEffect(() => {
        if (isFullHeight || displayOnlyCollections || note?.type === "book") {
            // Double role: no need to check if the note list is visible if the view is full-height or book, but also prevent legacy views if `displayOnlyCollections` is true.
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (!isIntersecting) {
                    setIsIntersecting(entries[0].isIntersecting);
                }
                observer.disconnect();
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
    }, []);

    // Preload the configuration.
    let props: ViewModeProps<any> | undefined | null = null;
    const viewModeConfig = useViewModeConfig(note, viewType);
    if (note && viewModeConfig) {
        props = {
            note, noteIds,
            highlightedTokens,
            viewConfig: viewModeConfig[0],
            saveConfig: viewModeConfig[1]
        }
    }

    return (
        <div ref={widgetRef} className={`note-list-widget ${isFullHeight ? "full-height" : ""}`}>
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

function useNoteIds(note: FNote | null | undefined, viewType: ViewTypeOptions | undefined) {
    const [ noteIds, setNoteIds ] = useState<string[]>([]);

    async function refreshNoteIds() {
        if (!note) {
            setNoteIds([]);
        } else if (viewType === "list" || viewType === "grid") {
            console.log("Refreshed note IDs");
            setNoteIds(note.getChildNoteIds());
        } else {
            console.log("Refreshed note IDs");
            setNoteIds(await note.getSubtreeNoteIds());
        }
    }

    // Refresh on note switch.
    useEffect(() => { refreshNoteIds() }, [ note ]);

    // Refresh on alterations to the note subtree.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().some(branch =>
                branch.parentNoteId === note.noteId
                || noteIds.includes(branch.parentNoteId ?? ""))) {
            refreshNoteIds();
        }
    })

    return noteIds;
}

function useViewModeConfig<T extends object>(note: FNote | null | undefined, viewType: ViewTypeOptions | undefined) {
    const [ viewConfig, setViewConfig ] = useState<[T | undefined, (data: T) => void]>();

    useEffect(() => {
        if (!note || !viewType) return;
        const viewStorage = new ViewModeStorage<T>(note, viewType);
        viewStorage.restore().then(config => {
            const storeFn = (config: T) => viewStorage.store(config);
            setViewConfig([ config, storeFn ]);
        });
    }, [ note, viewType ]);

    return viewConfig;
}
