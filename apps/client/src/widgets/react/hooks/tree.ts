import { useCallback, useContext, useDebugValue, useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type { NoteContextDataMap } from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import type { ViewScope } from "../../../services/link";
import tree from "../../../services/tree";
import type { ReactWrappedWidget } from "../../basic_widget";
import { ParentComponent } from "../react_utils";
import { useTriliumEvent, useTriliumEvents } from "./events";
import { useGetContextDataFrom } from "./note_context";

/**
 * Similar to {@link useNoteContext}, but instead of using the note context from the split container that the component is part of, it uses the active note context instead
 * (the note currently focused by the user).
 */
export function useActiveNoteContext() {
    // `desktop.ts` creates the tab manager after the first render of the layout.
    const [ noteContext, setNoteContext ] = useState<NoteContext | undefined>(appContext.tabManager?.getActiveContext() ?? undefined);
    const [ notePath, setNotePath ] = useState<string | null | undefined>();
    const [ note, setNote ] = useState<FNote | null | undefined>();
    const [ , setViewScope ] = useState<ViewScope>();
    const [ hoistedNoteId, setHoistedNoteId ] = useState(noteContext?.hoistedNoteId);
    const [ isReadOnlyTemporarilyDisabled, setIsReadOnlyTemporarilyDisabled ] = useState<boolean | null | undefined>(noteContext?.viewScope?.isReadOnly);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    useEffect(() => {
        if (!noteContext) {
            setNoteContext(appContext.tabManager?.getActiveContext() ?? undefined);
        }
    }, [ noteContext ]);

    useEffect(() => {
        setNote(noteContext?.note);
        setNotePath(noteContext?.notePath);
    }, [ notePath, noteContext?.note, noteContext?.notePath ]);

    useTriliumEvents([ "setNoteContext", "activeContextChanged", "noteSwitchedAndActivated", "noteSwitched" ], () => {
        const noteContext = appContext.tabManager.getActiveContext() ?? undefined;
        setNoteContext(noteContext);
        setHoistedNoteId(noteContext?.hoistedNoteId);
        setNotePath(noteContext?.notePath);
        setViewScope(noteContext?.viewScope);
        // Navigating resets the view scope, so the temporary "enable editing" toggle must be reset too,
        // otherwise the stale value prevents consumers from refreshing when editing is re-enabled.
        setIsReadOnlyTemporarilyDisabled(noteContext?.viewScope?.readOnlyTemporarilyDisabled);
    });
    useTriliumEvent("frocaReloaded", () => {
        setNote(noteContext?.note);
    });
    useTriliumEvent("noteTypeMimeChanged", ({ noteId }) => {
        if (noteId === note?.noteId) {
            setRefreshCounter(refreshCounter + 1);
        }
    });
    useTriliumEvent("readOnlyTemporarilyDisabled", ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext.ntxId === noteContext?.ntxId) {
            setIsReadOnlyTemporarilyDisabled(eventNoteContext?.viewScope?.readOnlyTemporarilyDisabled);
        }
    });
    useTriliumEvent("hoistedNoteChanged", ({ noteId, ntxId }) => {
        if (ntxId === noteContext?.ntxId) {
            setHoistedNoteId(noteId);
        }
    });
    /**
     * Note context doesn't actually refresh at all if the active note is moved around (e.g. the note path changes).
     * Address that by listening to note changes.
     */
    useTriliumEvent("entitiesReloaded", async ({ loadResults }) => {
        if (note && notePath && loadResults.getBranchRows().some(b => b.noteId === note.noteId)) {
            const resolvedNotePath = await tree.resolveNotePath(notePath, hoistedNoteId);
            setNotePath(resolvedNotePath);
        }
    });

    const parentComponent = useContext(ParentComponent) as ReactWrappedWidget;
    useDebugValue(() => `notePath=${notePath}, ntxId=${noteContext?.ntxId}`);

    return {
        note,
        noteId: noteContext?.note?.noteId,
        /** The note path of the note context. Unlike `noteContext.notePath`, this one actually reacts to the active note being moved around. */
        notePath,
        hoistedNoteId,
        ntxId: noteContext?.ntxId,
        viewScope: noteContext?.viewScope,
        componentId: parentComponent.componentId,
        noteContext,
        parentComponent,
        isReadOnlyTemporarilyDisabled
    };
}

export function useNoteTitle(noteId: string | undefined, parentNoteId: string | undefined) {
    const [ title, setTitle ] = useState<string>();
    const requestIdRef = useRef(0);

    const refresh = useCallback(() => {
        const requestId = ++requestIdRef.current;
        if (!noteId) return;
        tree.getNoteTitle(noteId, parentNoteId).then(title => {
            if (requestId !== requestIdRef.current) return;
            setTitle(title);
        });
    }, [ noteId, parentNoteId ]);

    useEffect(() => {
        refresh();
    }, [ refresh ]);

    // React to changes in protected session.
    useTriliumEvent("protectedSessionStarted", () => {
        refresh();
    });

    // React to external changes.
    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        if (loadResults.isNoteReloaded(noteId) || (parentNoteId && loadResults.getBranchRows().some(b => b.noteId === noteId && b.parentNoteId === parentNoteId))) {
            refresh();
        }
    }, [noteId, parentNoteId, refresh]));
    return title;
}

/**
 * Get context data from the active note context.
 * This is typically used in sidebar/toolbar components that need to display
 * data published by type widgets.
 *
 * The component will automatically re-render when the data changes.
 *
 * @param key - The data key to retrieve (e.g., "toc", "pdfPages")
 * @returns The current data, or undefined if not available
 *
 * @example
 * // In a Table of Contents sidebar widget:
 * function TableOfContents() {
 *   const headings = useGetContextData<Heading[]>("toc");
 *   if (!headings) return <div>No headings available</div>;
 *   return <ul>{headings.map(h => <li>{h.text}</li>)}</ul>;
 * }
 */
export function useGetContextData<K extends keyof NoteContextDataMap>(key: K): NoteContextDataMap[K] | undefined {
    const { noteContext } = useActiveNoteContext();
    return useGetContextDataFrom(noteContext, key);
}
