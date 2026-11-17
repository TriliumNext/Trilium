import type { NoteType } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useCallback, useContext, useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import protected_session_holder from "../../../services/protected_session_holder";
import server from "../../../services/server";
import SpacedUpdate, { type StateCallback } from "../../../services/spaced_update";
import { isShare } from "../../../services/utils";
import { noteSavedDataStore } from "../NoteStore";
import { ParentComponent } from "../react_utils";
import { useTriliumEvent } from "./events";
import { useNoteBlob } from "./note";

export interface SavedData {
    content: string;
    /** The blocks that `content` holds, a `block` link parameter, for an editor of some blocks. */
    block?: string;
    attachments?: {
        /** The attachment to update. Without it, the attachment is matched by its title. */
        attachmentId?: string;
        role: string;
        title: string;
        mime: string;
        content: string;
        position?: number;
        encoding?: "base64";
    }[];
}

export function useEditorSpacedUpdate({
    note, noteType, noteContext, getData, onContentChange, dataSaved, updateInterval, block,
    shownRef
}: {
    noteType: NoteType;
    note: FNote | null | undefined,
    noteContext: NoteContext | null | undefined,
    getData: () => Promise<SavedData | undefined> | SavedData | undefined,
    onContentChange: (newContent: string) => void,
    dataSaved?: (savedData: SavedData) => void,
    updateInterval?: number;
    /**
     * The blocks of the note to edit instead of the whole note, a `block` link parameter. Each
     * save replaces them, and the blocks that `getData()` reports are the ones the next save
     * replaces.
     */
    block?: string;
    /** The element of the editor. Content saved elsewhere loads into it once it is shown. */
    shownRef?: RefObject<Element | null>;
}) {
    const parentComponent = useContext(ParentComponent);
    const blockRef = useRef(block ?? "");
    const blob = useNoteBlob(note, parentComponent?.componentId, {
        reportLoadStateTo: noteContext,
        load: block === undefined
            ? undefined
            : (loadedNote) => loadBlocks(loadedNote, blockRef.current),
        shownRef
    });

    // The note whose content is currently loaded in the editor. Editor instances are reused
    // across note switches, so until the new note's blob arrives the editor still holds the
    // previous note's content — content that must never be saved under the new noteId (#9614).
    const loadedNoteIdRef = useRef<string | undefined>(undefined);

    const prepare = useCallback(() => {
        if (!note || loadedNoteIdRef.current !== note.noteId) return undefined;
        return getData();
    }, [ note, getData ]);

    const commit = useCallback(async (data: SavedData | undefined) => {
        // for read only notes, or if note is not yet available (e.g. lazy creation); a visitor of a
        // shared page cannot save
        if (data === undefined || !note || note.type !== noteType || isShare) return;
        // A deleted note is gone from `froca`, and the server refuses its changes.
        if (!(note.noteId in froca.notes)) return;

        protected_session_holder.touchProtectedSessionIfNecessary(note);

        if (block === undefined) {
            await server.put(`notes/${note.noteId}/data`, data, parentComponent?.componentId);
            noteSavedDataStore.set(note.noteId, data.content);
        } else {
            const { block: savedBlock, ...blocks } = data;
            const url = `notes/${note.noteId}/blocks?block=${encodeURIComponent(blockRef.current)}`;
            await server.put(url, blocks, parentComponent?.componentId);
            blockRef.current = savedBlock ?? blockRef.current;
        }
        dataSaved?.(data);
    }, [ note, dataSaved, noteType, parentComponent, block ]);

    const stateCallback = useCallback<StateCallback>((state) => {
        noteContext?.setContextData("saveState", {
            state
        });
    }, [ noteContext ]);
    const stateCallbackRef = useRef(stateCallback);
    useEffect(() => {
        stateCallbackRef.current = stateCallback;
    }, [ stateCallback ]);

    const spacedUpdateRef = useRef<SpacedUpdate<SavedData | undefined> | undefined>(undefined);
    if (!spacedUpdateRef.current) {
        spacedUpdateRef.current = new SpacedUpdate<SavedData | undefined>(
            { key: note?.noteId ?? null, prepare, commit },
            updateInterval,
            (state) => stateCallbackRef.current(state)
        );
    }
    const spacedUpdate = spacedUpdateRef.current;

    // Rebind to the current note on every render. When the note changes while a change is
    // still pending, rebind() snapshots it with the previous binding first, so it is saved
    // under the note it was typed into rather than the note the component now displays.
    useEffect(() => {
        spacedUpdate.rebind(note?.noteId ?? null, prepare, commit);
    });

    // React to note/blob changes.
    useEffect(() => {
        if (!blob || !note) return;
        // Changes not saved here yet stay when another editor saves the note, and replace it.
        if (loadedNoteIdRef.current === note.noteId && spacedUpdate.hasUnsavedChanges()) return;
        if (block === undefined) {
            noteSavedDataStore.set(note.noteId, blob.content);
        }
        spacedUpdate.allowUpdateWithoutChange(() => onContentChange(blob.content));
        loadedNoteIdRef.current = note.noteId;
    }, [ blob ]);

    // React to update interval changes.
    useEffect(() => {
        if (!updateInterval) return;
        spacedUpdate.setUpdateInterval(updateInterval);
    }, [ updateInterval ]);

    useSaveBeforeLeaving(spacedUpdate, noteContext);

    useTriliumEvent("saveNoteChanges", async ({ noteId }) => {
        if (noteId === note?.noteId) await spacedUpdate.updateNowIfNecessary();
    });

    return spacedUpdate;
}

/**
 * Saves the pending changes of `spacedUpdate` before the note of `noteContext` switches, before
 * its tab closes and before the window closes.
 */
export function useSaveBeforeLeaving<T>(
    spacedUpdate: SpacedUpdate<T>,
    noteContext: NoteContext | null | undefined
) {
    useTriliumEvent("beforeNoteSwitch", async ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext.ntxId !== noteContext?.ntxId) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    useTriliumEvent("beforeNoteContextRemove", async ({ ntxIds }) => {
        if (!noteContext?.ntxId || !ntxIds.includes(noteContext.ntxId)) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    useEffect(() => {
        const listener = () => spacedUpdate.isAllSavedAndTriggerUpdate();
        appContext.addBeforeUnloadListener(listener);
        return () => appContext.removeBeforeUnloadListener(listener);
    }, [ spacedUpdate ]);
}

/** The blocks of `note` that `block` points at, or `null` when they cannot be read. */
async function loadBlocks(note: FNote, block: string) {
    try {
        return await server.getWithSilentNotFound<{ content: string }>(
            `notes/${note.noteId}/blocks?block=${encodeURIComponent(block)}`
        );
    } catch {
        return null;
    }
}

export function useBlobEditorSpacedUpdate({ note, noteType, noteContext, getData, onContentChange, dataSaved, updateInterval, replaceWithoutRevision }: {
    noteType: NoteType;
    note: FNote,
    noteContext: NoteContext | null | undefined,
    getData: () => Promise<Blob | undefined> | Blob | undefined,
    onContentChange: (newBlob: FBlob) => void,
    dataSaved?: (savedData: Blob) => void,
    updateInterval?: number;
    /** If set to true, then the blob is replaced directly without saving a revision before. */
    replaceWithoutRevision?: boolean;
}) {
    const parentComponent = useContext(ParentComponent);
    const blob = useNoteBlob(note, parentComponent?.componentId, { reportLoadStateTo: noteContext });

    // Same provenance guard as useEditorSpacedUpdate: never save content under a note it
    // was not loaded from (#9614).
    const loadedNoteIdRef = useRef<string | undefined>(undefined);

    const prepare = useCallback(() => {
        if (loadedNoteIdRef.current !== note.noteId) return undefined;
        return getData();
    }, [ note, getData ]);

    const commit = useCallback(async (data: Blob | undefined) => {
        // for read only notes
        if (data === undefined || note.type !== noteType || !(note.noteId in froca.notes)) return;

        protected_session_holder.touchProtectedSessionIfNecessary(note);
        await server.upload(`notes/${note.noteId}/file?replace=${replaceWithoutRevision ? "1" : "0"}`, new File([ data ], note.title, { type: note.mime }), parentComponent?.componentId);
        dataSaved?.(data);
    }, [ note, dataSaved, noteType, parentComponent, replaceWithoutRevision ]);

    const stateCallback = useCallback<StateCallback>((state) => {
        noteContext?.setContextData("saveState", {
            state
        });
    }, [ noteContext ]);
    const stateCallbackRef = useRef(stateCallback);
    useEffect(() => {
        stateCallbackRef.current = stateCallback;
    }, [ stateCallback ]);

    const spacedUpdateRef = useRef<SpacedUpdate<Blob | undefined> | undefined>(undefined);
    if (!spacedUpdateRef.current) {
        spacedUpdateRef.current = new SpacedUpdate<Blob | undefined>(
            { key: note.noteId, prepare, commit },
            updateInterval,
            (state) => stateCallbackRef.current(state)
        );
    }
    const spacedUpdate = spacedUpdateRef.current;

    // Rebind to the current note on every render; flushes a pending change with the previous
    // binding when the note changes (see useEditorSpacedUpdate).
    useEffect(() => {
        spacedUpdate.rebind(note.noteId, prepare, commit);
    });

    // React to note/blob changes.
    useEffect(() => {
        if (!blob) return;
        spacedUpdate.allowUpdateWithoutChange(() => onContentChange(blob));
        loadedNoteIdRef.current = note.noteId;
    }, [ blob ]);

    // React to update interval changes.
    useEffect(() => {
        if (!updateInterval) return;
        spacedUpdate.setUpdateInterval(updateInterval);
    }, [ updateInterval ]);

    useSaveBeforeLeaving(spacedUpdate, noteContext);

    return spacedUpdate;
}

export function useNoteSavedData(noteId: string | undefined) {
    return useSyncExternalStore(
        (cb) => noteId ? noteSavedDataStore.subscribe(noteId, cb) : () => {},
        () => noteId ? noteSavedDataStore.get(noteId) : undefined
    );
}
