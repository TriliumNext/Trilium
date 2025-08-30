import { allViewTypes, ViewModeProps, ViewTypeOptions } from "./interface";
import { useNoteContext, useNoteLabel, useTriliumEvent } from "../react/hooks";
import FNote from "../../entities/fnote";
import "./NoteList.css";
import { ListView, GridView } from "./legacy/ListOrGridView";
import { useEffect, useRef, useState } from "preact/hooks";

interface NoteListProps {
    note?: FNote | null;
    /** if set to `true` then only collection-type views are displayed such as geo-map and the calendar. The original book types grid and list will be ignored. */
    displayOnlyCollections?: boolean;
    highlightedTokens?: string[] | null;
}

export default function NoteList({ note: providedNote, highlightedTokens, displayOnlyCollections }: NoteListProps) {
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

    return (
        <div ref={widgetRef} className={`note-list-widget ${isFullHeight ? "full-height" : ""}`}>
            {isEnabled && (
                <div className="note-list-widget-content">
                    {getComponentByViewType(note, noteIds, viewType, highlightedTokens)}
                </div>
            )}
        </div>
    );
}

function getComponentByViewType(note: FNote, noteIds: string[], viewType: ViewTypeOptions, highlightedTokens: string[] | null | undefined) {
    const props: ViewModeProps = { note, noteIds, highlightedTokens };

    switch (viewType) {
        case "list":
            return <ListView {...props} />;
        case "grid":
            return <GridView {...props} />;
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
