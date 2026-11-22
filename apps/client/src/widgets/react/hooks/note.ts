import type { BacklinkCountResponse, FilterLabelsByType, RelationNames } from "@triliumnext/commons";
import type { RefObject } from "preact";
import { useCallback, useDebugValue, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import type FAttachment from "../../../entities/fattachment";
import type FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import type { NotePathRecord } from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import type LoadResults from "../../../services/load_results";
import server from "../../../services/server";
import { useWhenShown } from "./dom";
import { useTriliumEvent } from "./events";

/**
 * Allows a React component to listen to obtain a property of a {@link FNote} while also automatically watching for changes, either via the user changing to a different note or the property being changed externally.
 *
 * @param note the {@link FNote} whose property to obtain.
 * @param property a property of a {@link FNote} to obtain the value from (e.g. `title`, `isProtected`).
 * @param componentId optionally, constricts the refresh of the value if an update occurs externally via the component ID of a legacy widget. This can be used to avoid external data replacing fresher, user-inputted data.
 * @returns the value of the requested property.
 */
export function useNoteProperty<T extends keyof FNote>(note: FNote | null | undefined, property: T, componentId?: string) {
    const [, setValue ] = useState<FNote[T] | undefined>(note?.[property]);
    const refreshValue = () => setValue(note?.[property]);

    // Watch for note changes.
    useEffect(() => refreshValue(), [ note, note?.[property] ]);

    // Watch for external changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteReloaded(note?.noteId, componentId)) {
            refreshValue();
        }
    });

    useDebugValue(property);
    return note?.[property];
}

export function useNoteRelation(note: FNote | undefined | null, relationName: RelationNames): [string | null | undefined, (newValue: string) => void] {
    const [ relationValue, setRelationValue ] = useState<string | null | undefined>(note?.getRelationValue(relationName));

    useEffect(() => setRelationValue(note?.getRelationValue(relationName) ?? null), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "relation" && attr.name === relationName && attributes.isAffecting(attr, note)) {
                if (!attr.isDeleted) {
                    setRelationValue(attr.value ?? null);
                } else {
                    setRelationValue(null);
                }
                break;
            }
        }
    });

    const setter = useCallback((value: string | undefined) => {
        if (note) {
            attributes.setAttribute(note, "relation", relationName, value);
        }
    }, [note]);

    useDebugValue(relationName);

    return [
        relationValue,
        setter
    ] as const;
}

export function useNoteRelationTarget(note: FNote, relationName: RelationNames) {
    const [ targetNote, setTargetNote ] = useState<FNote | null>();

    useEffect(() => {
        note.getRelationTarget(relationName).then(setTargetNote);
    }, [ note ]);

    return [ targetNote ] as const;
}

/**
 * Allows a React component to read or write a note's label while also reacting to changes in value.
 *
 * @param note the note whose label to read/write.
 * @param labelName the name of the label to read/write.
 * @returns an array where the first element is the getter and the second element is the setter. The setter has a special behaviour for convenience:
 * - if the value is undefined, the label is created without a value (e.g. a tag)
 * - if the value is null then the label is removed.
 */
export function useNoteLabel(note: FNote | undefined | null, labelName: FilterLabelsByType<string>): [string | null | undefined, (newValue: string | null | undefined) => void] {
    return useNoteLabelByName(note, labelName);
}

/**
 * The same as {@link useNoteLabel} for a label the app does not know by name — one the user named
 * themselves, e.g. a label a `#calendar:startDate` renaming points at. Prefer {@link useNoteLabel}
 * wherever the name is a builtin one, as it holds the name to the declared vocabulary.
 */
export function useNoteLabelByName(note: FNote | undefined | null, labelName: string): [string | null | undefined, (newValue: string | null | undefined) => Promise<unknown>] {
    const [ , setLabelValue ] = useState<string | null | undefined>();

    useEffect(() => setLabelValue(note?.getLabelValue(labelName) ?? null), [ note, labelName ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "label" && attr.name === labelName && attributes.isAffecting(attr, note)) {
                if (!attr.isDeleted) {
                    setLabelValue(attr.value);
                } else {
                    setLabelValue(null);
                }
                break;
            }
        }
    });

    const setter = useCallback(async (value: string | null | undefined) => {
        if (note) {
            if (value !== null) {
                await attributes.setLabel(note.noteId, labelName, value);
            } else {
                await attributes.removeOwnedLabelByName(note, labelName);
            }
        }
    }, [note, labelName]);

    useDebugValue(labelName);

    return [
        note?.getLabelValue(labelName),
        setter
    ] as const;
}

export function useNoteLabelWithDefault(note: FNote | undefined | null, labelName: FilterLabelsByType<string>, defaultValue: string): [string, (newValue: string | null | undefined) => void] {
    const [ labelValue, setLabelValue ] = useNoteLabel(note, labelName);
    return [ labelValue ?? defaultValue, setLabelValue];
}

export function useNoteLabelBoolean(note: FNote | undefined | null, labelName: FilterLabelsByType<boolean>): [ boolean, (newValue: boolean) => void] {
    const [, forceRender] = useState({});

    // Not on the first run: the render that mounted the component has already read the label, so
    // forcing another draws every consumer twice for a value that has not changed. 72 components
    // use this hook, and a board draws it once a card.
    const seenNote = useRef<FNote | undefined | null>(undefined);
    useEffect(() => {
        if (seenNote.current !== undefined) {
            forceRender({});
        }
        seenNote.current = note;
    }, [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "label" && attr.name === labelName && attributes.isAffecting(attr, note)) {
                forceRender({});
                break;
            }
        }
    });

    const setter = useCallback((value: boolean) => {
        if (note) {
            attributes.setBooleanWithInheritance(note, labelName, value);
        }
    }, [note, labelName]);

    useDebugValue(labelName);

    const labelValue = !!note?.isLabelTruthy(labelName);
    return [ labelValue, setter ] as const;
}

/**
 * Like {@link useNoteLabelBoolean} but returns `undefined` when the label is absent, allowing the caller
 * to distinguish between "explicitly false" and "not set" (for inheriting from a global default).
 */
export function useNoteLabelOptionalBool(note: FNote | undefined | null, labelName: FilterLabelsByType<boolean>): [ boolean | undefined, (newValue: boolean | null) => void] {
    //@ts-expect-error `useNoteLabel` only accepts string labels but we need to be able to read boolean ones.
    const [ value, setValue ] = useNoteLabel(note, labelName);
    useDebugValue(labelName);
    return [
        (value == null ? undefined : value !== "false"),
        (newValue) => setValue(newValue === null ? null : String(newValue))
    ];
}

export function useNoteLabelInt(note: FNote | undefined | null, labelName: FilterLabelsByType<number>): [ number | undefined, (newValue: number | null) => void] {
    //@ts-expect-error `useNoteLabel` only accepts string properties but we need to be able to read number ones.
    const [ value, setValue ] = useNoteLabel(note, labelName);
    useDebugValue(labelName);
    const parsed = value ? parseInt(value, 10) : undefined;
    return [
        (Number.isFinite(parsed) ? parsed : undefined),
        (newValue) => setValue(newValue === null ? null : String(newValue))
    ];
}

export function useNoteBlob<T extends { content: string } = FBlob>(note: FNote | null | undefined, componentId?: string, opts?: {
    /** Publish the fetch progress as `contentLoad` context data on the given note context, so
     * the note detail can show a loading state instead of the previous note's content. Should
     * only be set by widgets whose main content display is gated on this blob. (Passed
     * explicitly because NoteContextContext is only provided in dialogs, not the main window.) */
    reportLoadStateTo?: NoteContext | null;
    /** Whether the consuming widget is currently displayed. When explicitly `false`, load states
     * are not published — a cached/hidden type widget must not drive the note detail's loading
     * overlay over the widget the user is actually looking at (#10575). Leave undefined when the
     * consumer has no cached-hidden state. */
    isVisible?: boolean;
    /** Refetch on becoming visible if a content change was skipped while hidden because it came
     * from this widget's own component (`componentId`). For widgets that display saved content
     * produced by a sibling under the same parent component (e.g. the read-only text view behind
     * the editor), own-component changes are somebody else's edits that must eventually show. */
    refreshOnShow?: boolean;
    /** Reads the content instead of the blob of the note, resolving to `null` when it fails. */
    load?: (note: FNote) => Promise<T | null>;
    /**
     * The element that displays the content. While it is hidden, content saved elsewhere loads at
     * once, and the blob changes once the element is shown (`useWhenShown()`).
     */
    shownRef?: RefObject<Element | null>;
}): T | null | undefined {
    const [ blob, setBlob ] = useState<T | null>();
    const requestIdRef = useRef(0);
    /** The request whose content, saved elsewhere, waits for `shownRef` to show. */
    const waitingRequestIdRef = useRef<number | undefined>(undefined);
    const missedContentChangeRef = useRef(false);
    const whenShown = useWhenShown(opts?.shownRef);

    function reportLoadState(state: "loading" | "loaded" | "error") {
        if (opts?.isVisible === false) {
            return;
        }
        opts?.reportLoadStateTo?.setContextData("contentLoad", { state, retry: () => refresh() });
    }

    /** Loads the blob. With `isSavedElsewhere`, it applies once `shownRef` is shown. */
    async function refresh(isSavedElsewhere = false) {
        const requestId = ++requestIdRef.current;
        const isWaiting = isSavedElsewhere && !!opts?.shownRef;
        waitingRequestIdRef.current = isWaiting ? requestId : undefined;
        if (note && !isWaiting) {
            reportLoadState("loading");
        }
        const newBlob = note && opts?.load
            ? await opts.load(note)
            : await note?.getBlob() as T | null | undefined;

        // Only update if this is the latest request.
        if (requestId !== requestIdRef.current) return;
        const update = () => {
            if (requestId !== requestIdRef.current) return;
            setBlob(newBlob);
            if (note) {
                // froca.getBlob() resolves to null when the fetch failed.
                reportLoadState(newBlob ? "loaded" : "error");
            }
        };
        if (isWaiting) {
            whenShown(update);
        } else {
            update();
        }
    }

    useEffect(() => { refresh(); }, [ note?.noteId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (!note) return;

        // Check if the note was deleted.
        if (loadResults.getEntityRow("notes", note.noteId)?.isDeleted) {
            requestIdRef.current++; // invalidate pending results
            setBlob(null);
            return;
        }

        if (loadResults.isNoteContentReloaded(note.noteId, componentId)) {
            refresh(true);
        } else if (opts?.refreshOnShow && loadResults.isNoteContentReloaded(note.noteId)) {
            // The change came from our own component, so the refetch was skipped; remember it so
            // the content is brought up to date when the widget is displayed again.
            missedContentChangeRef.current = true;
        } else if (loadResults.isNoteContentReloaded(note.noteId)
            && waitingRequestIdRef.current === requestIdRef.current) {
            // A later save here outdates the content that waits to show.
            requestIdRef.current++;
        }
    });

    useEffect(() => {
        if (opts?.refreshOnShow && opts?.isVisible && missedContentChangeRef.current) {
            missedContentChangeRef.current = false;
            refresh();
        }
    }, [ opts?.isVisible ]); // eslint-disable-line react-hooks/exhaustive-deps

    useDebugValue(note?.noteId);

    return blob;
}

export function useChildNotes(parentNoteId: string | undefined) {
    const [ childNotes, setChildNotes ] = useState<FNote[]>([]);

    const refresh = useCallback(async () => {
        let childNotes: FNote[] | undefined;
        if (parentNoteId) {
            const parentNote = await froca.getNote(parentNoteId);
            childNotes = await parentNote?.getChildNotes();
        }
        setChildNotes(childNotes ?? []);
    }, [ parentNoteId ]);

    useEffect(() => {
        refresh();
    }, [ refresh ]);

    // Swap to fresh FNote refs after a full froca reload (e.g. entering a protected session
    // clears the cache and creates new instances — old refs are orphaned with stale titles).
    useTriliumEvent("frocaReloaded", () => {
        refresh();
    });

    // Refresh on branch changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (parentNoteId && loadResults.getBranchRows().some(branch => branch.parentNoteId === parentNoteId)) {
            refresh();
        }
    });

    return childNotes;
}

export function useLauncherVisibility(launchNoteId: string) {
    const checkIfVisible = useCallback(() => {
        const note = froca.getNoteFromCache(launchNoteId);
        return note?.getParentBranches().some(branch =>
            [ "_lbVisibleLaunchers", "_lbMobileVisibleLaunchers" ].includes(branch.parentNoteId)) ?? false;
    }, [ launchNoteId ]);

    const [ isVisible, setIsVisible ] = useState<boolean>(checkIfVisible());

    // React to note not being available in the cache.
    useEffect(() => {
        froca.getNote(launchNoteId).then(() => setIsVisible(checkIfVisible()));
    }, [ launchNoteId, checkIfVisible ]);

    // React to changes.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getBranchRows().some(branch => branch.noteId === launchNoteId)) {
            setIsVisible(checkIfVisible());
        }
    });

    return isVisible;
}

export function useNote(noteId: string | null | undefined, silentNotFoundError = false) {
    const [ note, setNote ] = useState(noteId ? froca.getNoteFromCache(noteId) : undefined);
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (!noteId) {
            setNote(undefined);
            return;
        }

        if (note?.noteId === noteId) {
            return;
        }

        // Try to read from cache.
        const cachedNote = froca.getNoteFromCache(noteId);
        if (cachedNote) {
            setNote(cachedNote);
            return;
        }

        // Read it asynchronously.
        const requestId = ++requestIdRef.current;
        froca.getNote(noteId, silentNotFoundError).then(readNote => {
            // Only update if this is the latest request.
            if (readNote && requestId === requestIdRef.current) {
                setNote(readNote);
            }
        });
    }, [ note, noteId, silentNotFoundError ]);

    if (!noteId) {
        return undefined;
    }
    if (note?.noteId === noteId) {
        return note;
    }
    // The state only catches up in the effect above — after the mismatched render is already
    // painted. A note the cache holds is answered in the same render instead: an id change must
    // not paint a note-less frame in between, which read as a width wobble everywhere the host
    // keeps something open for exactly as long as there is a note (the calendar's detail dock).
    return froca.getNoteFromCache(noteId) ?? undefined;
}

export function useNoteIcon(note: FNote | null | undefined) {
    const [ icon, setIcon ] = useState(note?.getIcon());
    const iconClass = useNoteLabel(note, "iconClass");
    useEffect(() => {
        setIcon(note?.getIcon());
    }, [ note, iconClass ]);

    return icon;
}

export function useNoteColorClass(note: FNote | null | undefined) {
    const [ colorClass, setColorClass ] = useState(note?.getColorClass());
    const [ color ] = useNoteLabel(note, "color");
    useEffect(() => {
        setColorClass(note?.getColorClass());
    }, [ color, note ]);
    return colorClass;
}

export function useAttachments(note: FNote) {
    const [ attachments, setAttachments ] = useState<FAttachment[]>([]);

    function refresh() {
        note.getAttachments().then(attachments => setAttachments(Array.from(attachments)));
    }

    useEffect(refresh, [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttachmentRows().some((att) => att.attachmentId && att.ownerId === note.noteId)) {
            refresh();
        }
    });

    return attachments;
}

/** The places of `note` in the tree that are not hidden, sorted by `getSortedNotePathRecords()`. */
export function useSortedNotePaths(note: FNote | null | undefined, hoistedNoteId?: string) {
    const [ sortedNotePaths, setSortedNotePaths ] = useState<NotePathRecord[]>();

    function refresh() {
        if (!note) return;
        setSortedNotePaths(note
            .getSortedNotePathRecords(hoistedNoteId)
            .filter((notePath) => !notePath.isHidden));
    }

    useEffect(refresh, [ note, hoistedNoteId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (!noteId) return;
        if (loadResults.getBranchRows().find((branch) => branch.noteId === noteId)
            || loadResults.isNoteReloaded(noteId)) {
            refresh();
        }
    });

    return sortedNotePaths;
}

/** The number of notes that link to `note`, fetched again when a relation pointing at it changes. */
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
        if (note && hasBacklinkChanges(loadResults, note)) refresh();
    });

    return backlinkCount;
}

/**
 * Whether `loadResults` adds, changes or deletes a relation that points at `note`. A backlink is
 * owned by the other note, so `attributes.isAffecting()` does not see it.
 */
export function hasBacklinkChanges(loadResults: LoadResults, note: FNote) {
    return loadResults.getAttributeRows().some((attr) =>
        attr.type === "relation" && attr.value === note.noteId);
}
