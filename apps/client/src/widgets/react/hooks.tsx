import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { FilterLabelsByType, KeyboardActionNames, NoteType, OptionNames, RelationNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import Mark from "mark.js";
import { Ref, RefObject, VNode } from "preact";
import { CSSProperties, useSyncExternalStore } from "preact/compat";
import { MutableRef, useCallback, useContext, useDebugValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext, { EventData, EventNames } from "../../components/app_context";
import Component from "../../components/component";
import NoteContext, { NoteContextDataMap } from "../../components/note_context";
import FBlob from "../../entities/fblob";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import keyboard_actions from "../../services/keyboard_actions";
import { parseNavigationStateFromUrl, ViewScope } from "../../services/link";
import options, { type OptionValue } from "../../services/options";
import protected_session_holder from "../../services/protected_session_holder";
import server from "../../services/server";
import shortcuts, { Handler, removeIndividualBinding } from "../../services/shortcuts";
import SpacedUpdate, { type StateCallback } from "../../services/spaced_update";
import { getEffectiveThemeStyle } from "../../services/theme";
import toast, { ToastOptions } from "../../services/toast";
import tree from "../../services/tree";
import utils, { escapeRegExp, getErrorMessage, randomString, reloadFrontendApp } from "../../services/utils";
import ws from "../../services/ws";
import BasicWidget, { ReactWrappedWidget } from "../basic_widget";
import NoteContextAwareWidget from "../note_context_aware_widget";
import { DragData } from "../note_tree";
import { noteSavedDataStore } from "./NoteStore";
import { NoteContextContext, ParentComponent, refToJQuerySelector } from "./react_utils";

export function useTriliumEvent<T extends EventNames>(eventName: T, handler: (data: EventData<T>) => void) {
    const parentComponent = useContext(ParentComponent);
    useLayoutEffect(() => {
        parentComponent?.registerHandler(eventName, handler);
        return (() => parentComponent?.removeHandler(eventName, handler));
    }, [ eventName, handler ]);
    useDebugValue(eventName);
}

export function useTriliumEvents<T extends EventNames>(eventNames: T[], handler: (data: EventData<T>, eventName: T) => void) {
    const parentComponent = useContext(ParentComponent);

    useLayoutEffect(() => {
        const handlers: ({ eventName: T, callback: (data: EventData<T>) => unknown })[] = [];
        for (const eventName of eventNames) {
            // Return the handler's result so async handlers stay awaitable through triggerEvent().
            handlers.push({ eventName, callback: (data) => handler(data, eventName) });
        }

        for (const { eventName, callback } of handlers) {
            parentComponent?.registerHandler(eventName, callback);
        }

        return (() => {
            for (const { eventName, callback } of handlers) {
                parentComponent?.removeHandler(eventName, callback);
            }
        });
    }, [ eventNames, handler ]);
    useDebugValue(() => eventNames.join(", "));
}

export function useSpacedUpdate(callback: () => void | Promise<void>, interval = 1000, stateCallback?: StateCallback) {
    const callbackRef = useRef(callback);
    const stateCallbackRef = useRef(stateCallback);
    const spacedUpdateRef = useRef<SpacedUpdate>(new SpacedUpdate(
        () => callbackRef.current(),
        interval,
        (state) => stateCallbackRef.current?.(state)
    ));

    // Update callback ref when it changes
    useEffect(() => {
        callbackRef.current = callback;
    }, [ callback ]);

    // Update state callback when it changes.
    useEffect(() => {
        stateCallbackRef.current = stateCallback;
    }, [ stateCallback ]);

    // Update interval if it changes
    useEffect(() => {
        spacedUpdateRef.current?.setUpdateInterval(interval);
    }, [ interval ]);

    return spacedUpdateRef.current;
}

export interface SavedData {
    content: string;
    attachments?: {
        role: string;
        title: string;
        mime: string;
        content: string;
        position: number;
        encoding?: "base64";
    }[];
}

export function useEditorSpacedUpdate({ note, noteType, noteContext, getData, onContentChange, dataSaved, updateInterval }: {
    noteType: NoteType;
    note: FNote | null | undefined,
    noteContext: NoteContext | null | undefined,
    getData: () => Promise<SavedData | undefined> | SavedData | undefined,
    onContentChange: (newContent: string) => void,
    dataSaved?: (savedData: SavedData) => void,
    updateInterval?: number;
}) {
    const parentComponent = useContext(ParentComponent);
    const blob = useNoteBlob(note, parentComponent?.componentId, { reportLoadStateTo: noteContext });

    // The note whose content is currently loaded in the editor. Editor instances are reused
    // across note switches, so until the new note's blob arrives the editor still holds the
    // previous note's content — content that must never be saved under the new noteId (#9614).
    const loadedNoteIdRef = useRef<string>();

    const prepare = useCallback(() => {
        if (!note || loadedNoteIdRef.current !== note.noteId) return undefined;
        return getData();
    }, [ note, getData ]);

    const commit = useCallback(async (data: SavedData | undefined) => {
        // for read only notes, or if note is not yet available (e.g. lazy creation)
        if (data === undefined || !note || note.type !== noteType) return;

        protected_session_holder.touchProtectedSessionIfNecessary(note);

        await server.put(`notes/${note.noteId}/data`, data, parentComponent?.componentId);

        noteSavedDataStore.set(note.noteId, data.content);
        dataSaved?.(data);
    }, [ note, dataSaved, noteType, parentComponent ]);

    const stateCallback = useCallback<StateCallback>((state) => {
        noteContext?.setContextData("saveState", {
            state
        });
    }, [ noteContext ]);
    const stateCallbackRef = useRef(stateCallback);
    useEffect(() => {
        stateCallbackRef.current = stateCallback;
    }, [ stateCallback ]);

    const spacedUpdateRef = useRef<SpacedUpdate<SavedData | undefined>>();
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
        noteSavedDataStore.set(note.noteId, blob.content);
        spacedUpdate.allowUpdateWithoutChange(() => onContentChange(blob.content));
        loadedNoteIdRef.current = note.noteId;
    }, [ blob ]);

    // React to update interval changes.
    useEffect(() => {
        if (!updateInterval) return;
        spacedUpdate.setUpdateInterval(updateInterval);
    }, [ updateInterval ]);

    // Save if needed upon switching tabs.
    useTriliumEvent("beforeNoteSwitch", async ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext.ntxId !== noteContext?.ntxId) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    // Save if needed upon tab closing.
    useTriliumEvent("beforeNoteContextRemove", async ({ ntxIds }) => {
        if (!noteContext?.ntxId || !ntxIds.includes(noteContext.ntxId)) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    // Save if needed upon window/browser closing.
    useEffect(() => {
        const listener = () => spacedUpdate.isAllSavedAndTriggerUpdate();
        appContext.addBeforeUnloadListener(listener);
        return () => appContext.removeBeforeUnloadListener(listener);
    }, []);

    return spacedUpdate;
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
    const loadedNoteIdRef = useRef<string>();

    const prepare = useCallback(() => {
        if (loadedNoteIdRef.current !== note.noteId) return undefined;
        return getData();
    }, [ note, getData ]);

    const commit = useCallback(async (data: Blob | undefined) => {
        // for read only notes
        if (data === undefined || note.type !== noteType) return;

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

    const spacedUpdateRef = useRef<SpacedUpdate<Blob | undefined>>();
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

    // Save if needed upon switching tabs.
    useTriliumEvent("beforeNoteSwitch", async ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext.ntxId !== noteContext?.ntxId) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    // Save if needed upon tab closing.
    useTriliumEvent("beforeNoteContextRemove", async ({ ntxIds }) => {
        if (!noteContext?.ntxId || !ntxIds.includes(noteContext.ntxId)) return;
        await spacedUpdate.updateNowIfNecessary();
    });

    // Save if needed upon window/browser closing.
    useEffect(() => {
        const listener = () => spacedUpdate.isAllSavedAndTriggerUpdate();
        appContext.addBeforeUnloadListener(listener);
        return () => appContext.removeBeforeUnloadListener(listener);
    }, []);

    return spacedUpdate;
}

export function useNoteSavedData(noteId: string | undefined) {
    return useSyncExternalStore(
        (cb) => noteId ? noteSavedDataStore.subscribe(noteId, cb) : () => {},
        () => noteId ? noteSavedDataStore.get(noteId) : undefined
    );
}


/**
 * Allows a React component to read and write a Trilium option, while also watching for external changes.
 *
 * Conceptually, `useTriliumOption` works just like `useState`, but the value is also automatically updated if
 * the option is changed somewhere else in the client.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOption(name: OptionNames, needsRefresh?: boolean): [string, (newValue: OptionValue) => Promise<void>] {
    const initialValue = options.get(name);
    const [ value, setValue ] = useState(initialValue);

    const wrappedSetValue = useMemo(() => {
        return async (newValue: OptionValue) => {
            const originalValue = value;
            setValue(String(newValue));
            try {
                await options.save(name, newValue);
            } catch (e: unknown) {
                ws.logError(getErrorMessage(e));
                setValue(originalValue);
            }

            if (needsRefresh) {
                reloadFrontendApp(`option change: ${name}`);
            }
        };
    }, [ name, needsRefresh, value ]);

    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        if (loadResults.getOptionNames().includes(name)) {
            const newValue = options.get(name);
            setValue(newValue);
        }
    }, [ name, setValue ]));

    useDebugValue(name);

    return [
        value,
        wrappedSetValue
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the value is converted to and from a boolean instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionBool(name: OptionNames, needsRefresh?: boolean): [boolean, (newValue: boolean) => Promise<void>] {
    const [ value, setValue ] = useTriliumOption(name, needsRefresh);
    useDebugValue(name);
    return [
        (value === "true"),
        (newValue) => setValue(newValue ? "true" : "false")
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the value is converted to and from a int instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionInt(name: OptionNames): [number, (newValue: number) => Promise<void>] {
    const [ value, setValue ] = useTriliumOption(name);
    useDebugValue(name);
    return [
        (parseInt(value, 10)),
        (newValue) => setValue(newValue)
    ];
}

/**
 * Similar to {@link useTriliumOption}, but the object value is parsed to and from a JSON instead of a string.
 *
 * @param name the name of the option to listen for.
 * @param needsRefresh whether to reload the frontend whenever the value is changed.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionJson<T>(name: OptionNames, needsRefresh?: boolean): [ T, (newValue: T) => Promise<void> ] {
    const [ value, setValue ] = useTriliumOption(name, needsRefresh);
    useDebugValue(name);
    return [
        (JSON.parse(value) as T),
        (newValue => setValue(JSON.stringify(newValue)))
    ];
}

/**
 * Similar to {@link useTriliumOption}, but operates with multiple options at once.
 *
 * @param names the name of the option to listen for.
 * @returns an array where the first value is a map where the keys are the option names and the values, and the second value is the setter which takes in the same type of map and saves them all at once.
 */
export function useTriliumOptions<T extends OptionNames>(...names: T[]) {
    const values: Record<string, string> = {};
    for (const name of names) {
        values[name] = options.get(name);
    }

    useDebugValue(() => names.join(", "));

    return [
        values as Record<T, string>,
        options.saveMany
    ] as const;
}

/**
 * Generates a unique name via a random alphanumeric string of a fixed length.
 *
 * <p>
 * Generally used to assign names to inputs that are unique, especially useful for widgets inside tabs.
 *
 * @param prefix a prefix to add to the unique name.
 * @returns a name with the given prefix and a random alpanumeric string appended to it.
 */
export function useUniqueName(prefix?: string) {
    return useMemo(() => (prefix ? `${prefix}-` : "") + utils.randomString(10), [ prefix ]);
}

export function useNoteContext() {
    const parentComponent = useContext(ParentComponent) as ReactWrappedWidget;
    const noteContextContext = useContext(NoteContextContext);
    // Components can mount after the initial setNoteContext event has already been dispatched
    // (e.g. when rendered via LazyComponent), so fall back to the note context held by the
    // closest legacy ancestor instead of waiting for the next note switch.
    const [ noteContext, setNoteContext ] = useState<NoteContext | undefined>(() => noteContextContext ?? findClosestNoteContext(parentComponent));
    const [ notePath, setNotePath ] = useState<string | null | undefined>(noteContext?.notePath);
    const [ note, setNote ] = useState<FNote | null | undefined>(noteContext?.note);
    const [ hoistedNoteId, setHoistedNoteId ] = useState(noteContext?.hoistedNoteId);
    const [ , setViewScope ] = useState<ViewScope>();
    const [ isReadOnlyTemporarilyDisabled, setIsReadOnlyTemporarilyDisabled ] = useState<boolean | null | undefined>(noteContext?.viewScope?.isReadOnly);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    useEffect(() => {
        if (!noteContextContext) return;
        setNoteContext(noteContextContext);
        setHoistedNoteId(noteContextContext.hoistedNoteId);
        setNote(noteContextContext.note);
        setNotePath(noteContextContext.notePath);
        setViewScope(noteContextContext.viewScope);
        setIsReadOnlyTemporarilyDisabled(noteContextContext?.viewScope?.readOnlyTemporarilyDisabled);
    }, [ noteContextContext ]);

    useEffect(() => {
        setNote(noteContext?.note);
    }, [ notePath ]);

    useTriliumEvents([ "setNoteContext", "activeContextChanged", "noteSwitchedAndActivated", "noteSwitched" ], ({ noteContext }) => {
        // When bound to a specific context via the provider (the quick-edit popup), ignore events for
        // other contexts, but still react when our own bound context navigates in place (e.g. switching
        // settings pages from the in-popup selector) — otherwise the popup would stay on the first page.
        if (noteContextContext && noteContext !== noteContextContext) return;
        setNoteContext(noteContext);
        setHoistedNoteId(noteContext.hoistedNoteId);
        setNotePath(noteContext.notePath);
        setViewScope(noteContext.viewScope);
        // Navigating resets the view scope, so the temporary "enable editing" toggle must be reset too.
        // Otherwise the stale value prevents consumers (e.g. the ribbon) from refreshing when the user
        // re-enables editing on a note that was previously made temporarily editable.
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
        if (noteContextContext) return;
        if (eventNoteContext.ntxId === noteContext?.ntxId) {
            setIsReadOnlyTemporarilyDisabled(eventNoteContext?.viewScope?.readOnlyTemporarilyDisabled);
        }
    });
    useTriliumEvent("hoistedNoteChanged", ({ noteId, ntxId }) => {
        if (ntxId === noteContext?.ntxId) {
            setHoistedNoteId(noteId);
        }
    });

    useDebugValue(() => `notePath=${notePath}, ntxId=${noteContext?.ntxId}`);

    return {
        note,
        noteId: noteContext?.note?.noteId,
        notePath: noteContext?.notePath,
        hoistedNoteId,
        ntxId: noteContext?.ntxId,
        viewScope: noteContext?.viewScope,
        componentId: parentComponent.componentId,
        noteContext,
        parentComponent,
        isReadOnlyTemporarilyDisabled
    };
}

/**
 * Finds the note context held by the closest legacy ancestor component (e.g. the note split's
 * `NoteWrapperWidget`). Used to initialize {@link useNoteContext} for components that mount after
 * the initial `setNoteContext` event has been dispatched (e.g. components rendered via
 * `LazyComponent`), which would otherwise not know their context until the next note switch.
 */
function findClosestNoteContext(component: Component | null): NoteContext | undefined {
    let current: Component | undefined = component ?? undefined;
    while (current) {
        if ("noteContext" in current) {
            const { noteContext } = current as { noteContext?: NoteContext };
            if (noteContext) {
                return noteContext;
            }
        }
        current = current.parent as Component | undefined;
    }
    return undefined;
}

/**
 * Similar to {@link useNoteContext}, but instead of using the note context from the split container that the component is part of, it uses the active note context instead
 * (the note currently focused by the user).
 */
export function useActiveNoteContext() {
    const [ noteContext, setNoteContext ] = useState<NoteContext | undefined>(appContext.tabManager.getActiveContext() ?? undefined);
    const [ notePath, setNotePath ] = useState<string | null | undefined>();
    const [ note, setNote ] = useState<FNote | null | undefined>();
    const [ , setViewScope ] = useState<ViewScope>();
    const [ hoistedNoteId, setHoistedNoteId ] = useState(noteContext?.hoistedNoteId);
    const [ isReadOnlyTemporarilyDisabled, setIsReadOnlyTemporarilyDisabled ] = useState<boolean | null | undefined>(noteContext?.viewScope?.isReadOnly);
    const [ refreshCounter, setRefreshCounter ] = useState(0);

    useEffect(() => {
        if (!noteContext) {
            setNoteContext(appContext.tabManager.getActiveContext() ?? undefined);
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
    const [ , setLabelValue ] = useState<string | null | undefined>();

    useEffect(() => setLabelValue(note?.getLabelValue(labelName) ?? null), [ note ]);
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

    const setter = useCallback((value: string | null | undefined) => {
        if (note) {
            if (value !== null) {
                attributes.setLabel(note.noteId, labelName, value);
            } else {
                attributes.removeOwnedLabelByName(note, labelName);
            }
        }
    }, [note]);

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

    useEffect(() => {
        forceRender({});
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

export function useNoteBlob(note: FNote | null | undefined, componentId?: string, opts?: {
    /** Publish the fetch progress as `contentLoad` context data on the given note context, so
     * the note detail can show a loading state instead of the previous note's content. Should
     * only be set by widgets whose main content display is gated on this blob. (Passed
     * explicitly because NoteContextContext is only provided in dialogs, not the main window.) */
    reportLoadStateTo?: NoteContext | null;
}): FBlob | null | undefined {
    const [ blob, setBlob ] = useState<FBlob | null>();
    const requestIdRef = useRef(0);

    function reportLoadState(state: "loading" | "loaded" | "error") {
        opts?.reportLoadStateTo?.setContextData("contentLoad", { state, retry: () => refresh() });
    }

    async function refresh() {
        const requestId = ++requestIdRef.current;
        if (note) {
            reportLoadState("loading");
        }
        const newBlob = await note?.getBlob();

        // Only update if this is the latest request.
        if (requestId === requestIdRef.current) {
            setBlob(newBlob);
            if (note) {
                // froca.getBlob() resolves to null when the fetch failed.
                reportLoadState(newBlob ? "loaded" : "error");
            }
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
            refresh();
        }
    });

    useDebugValue(note?.noteId);

    return blob;
}

export function useLegacyWidget<T extends BasicWidget>(widgetFactory: () => T, { noteContext, containerClassName, containerStyle }: {
    noteContext?: NoteContext;
    containerClassName?: string;
    containerStyle?: CSSProperties;
} = {}): [VNode, T] {
    const ref = useRef<HTMLDivElement>(null);
    const parentComponent = useContext(ParentComponent);

    // Render the widget once - note that noteContext is intentionally NOT a dependency
    // to prevent creating new widget instances on every note switch.
    const [ widget, renderedWidget ] = useMemo(() => {
        const widget = widgetFactory();

        if (parentComponent) {
            parentComponent.child(widget);
        }

        const renderedWidget = widget.render();
        return [ widget, renderedWidget ];
    }, [ parentComponent ]); // eslint-disable-line react-hooks/exhaustive-deps
    // widgetFactory() and noteContext are intentionally left out - widget should be created once
    // and updated via activeContextChangedEvent when noteContext changes.

    // Cleanup: remove widget from parent's children when unmounted
    useEffect(() => {
        return () => {
            if (parentComponent) {
                parentComponent.removeChild(widget);
            }
            widget.cleanup();
        };
    }, [ parentComponent, widget ]);

    // Attach the widget to the parent.
    useEffect(() => {
        const parentContainer = ref.current;
        if (parentContainer) {
            parentContainer.replaceChildren();
            renderedWidget.appendTo(parentContainer);
        }
    }, [ renderedWidget ]);

    // Inject the note context - this updates the existing widget without recreating it.
    // We check if the context actually changed to avoid double refresh when the event system
    // also delivers activeContextChanged to the widget through component tree propagation.
    useEffect(() => {
        if (noteContext && widget instanceof NoteContextAwareWidget) {
            // Only trigger refresh if the context actually changed.
            // The event system may have already updated the widget, in which case
            // widget.noteContext will already equal noteContext.
            if (widget.noteContext !== noteContext) {
                widget.activeContextChangedEvent({ noteContext });
            }
        }
    }, [ noteContext, widget ]);

    useDebugValue(widget);

    return [ <div className={containerClassName} style={containerStyle} ref={ref} />, widget ];
}

/**
 * Attaches a {@link ResizeObserver} to the given ref and reads the bounding client rect whenever it changes.
 *
 * @param ref a ref to a {@link HTMLElement} to determine the size and observe the changes in size.
 * @returns the size of the element, reacting to changes.
 */
export function useElementSize(ref: RefObject<HTMLElement>) {
    const [ size, setSize ] = useState<DOMRect | undefined>(ref.current?.getBoundingClientRect());

    useEffect(() => {
        if (!ref.current) {
            return;
        }

        function onResize() {
            setSize(ref.current?.getBoundingClientRect());
        }

        const element = ref.current;
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(element);
        return () => {
            resizeObserver.unobserve(element);
            resizeObserver.disconnect();
        };
    }, [ ref ]);

    return size;
}

/**
 * Obtains the inner width and height of the window, as well as reacts to changes in size.
 *
 * @returns the width and height of the window.
 */
export function useWindowSize() {
    const [ size, setSize ] = useState<{ windowWidth: number, windowHeight: number }>({
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight
    });

    useEffect(() => {
        function onResize() {
            setSize({
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });
        }

        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return size;
}

/** Mobile viewports at least this wide (tablets) keep a side-by-side layout; narrower ones get the
 *  master-detail flow. */
export const MASTER_DETAIL_TABLET_MIN_WIDTH = 768;

export interface MobileMasterDetail {
    /** True on narrow mobile viewports where the list and detail collapse into a master-detail flow. */
    isMasterDetail: boolean;
    /** Which half of the master-detail flow is currently visible. */
    mobileView: "list" | "page";
    /** Switch between the two views with a slide animation. */
    switchMobileView: (view: "list" | "page") => void;
    /** Set the view directly without animating (e.g. when (re)opening the dialog). */
    resetMobileView: (view: "list" | "page") => void;
}

/**
 * Drives the mobile master-detail flow shared by dialogs that pair a list with a detail pane (e.g.
 * the settings and revisions dialogs): it tracks which pane is visible, animates the slide between
 * them, and toggles the corresponding classes on the modal element (`mobile-master-detail`,
 * `mobile-view-{list,page}`, `mobile-transition-to-{list,page}`). The dialog supplies the layout and
 * slide keyframes in CSS; the keyframe names must start with `slideAnimationPrefix` so the in-flight
 * transition can be cleared once the slide finishes.
 */
export function useMobileMasterDetail(modalRef: RefObject<HTMLElement>, slideAnimationPrefix: string): MobileMasterDetail {
    const [ mobileView, setMobileView ] = useState<"list" | "page">("list");
    // Direction of the in-flight slide between the two views, or null when at rest. While set, both
    // panes stay rendered so the outgoing one can slide away as the incoming one slides in.
    const [ mobileTransition, setMobileTransition ] = useState<"to-list" | "to-page" | null>(null);
    const isMobile = utils.isMobile();
    const { windowWidth } = useWindowSize();
    const isMasterDetail = isMobile && windowWidth < MASTER_DETAIL_TABLET_MIN_WIDTH;

    const switchMobileView = useCallback((view: "list" | "page") => {
        if (view === mobileView) return;
        setMobileView(view);
        // With animations globally disabled there is no animationend to clear the transition, so
        // switch directly. Outside the master-detail flow there is nothing to animate.
        if (isMasterDetail && !document.body.classList.contains("motion-disabled")) {
            setMobileTransition(view === "page" ? "to-page" : "to-list");
        }
    }, [ mobileView, isMasterDetail ]);

    const resetMobileView = useCallback((view: "list" | "page") => {
        setMobileView(view);
        setMobileTransition(null);
    }, []);

    // Bootstrap adds its own classes (e.g. `show`) to the modal element at runtime, so the className
    // prop must stay static; toggle the mobile view classes directly on the element instead.
    useEffect(() => {
        modalRef.current?.classList.toggle("mobile-master-detail", isMasterDetail);
        modalRef.current?.classList.toggle("mobile-view-list", mobileView === "list");
        modalRef.current?.classList.toggle("mobile-view-page", mobileView === "page");
        modalRef.current?.classList.toggle("mobile-transition-to-list", mobileTransition === "to-list");
        modalRef.current?.classList.toggle("mobile-transition-to-page", mobileTransition === "to-page");
    }, [ isMasterDetail, mobileView, mobileTransition ]);

    // End the view transition once the slide finishes (animationend bubbles up from the panes).
    useEffect(() => {
        const modalElement = modalRef.current;
        if (!modalElement) return;
        function onAnimationEnd(e: AnimationEvent) {
            if (e.animationName.startsWith(slideAnimationPrefix)) {
                setMobileTransition(null);
            }
        }
        modalElement.addEventListener("animationend", onAnimationEnd);
        return () => modalElement.removeEventListener("animationend", onAnimationEnd);
    }, [ slideAnimationPrefix ]);

    return { isMasterDetail, mobileView, switchMobileView, resetMobileView };
}

// Workaround for https://github.com/twbs/bootstrap/issues/37474
// Bootstrap's dispose() sets ALL properties to null. But pending animation callbacks
// (scheduled via setTimeout) can still fire and crash when accessing null properties.
// We patch dispose() to set safe placeholder values instead of null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TooltipProto = Tooltip.prototype as any;
const originalDispose = TooltipProto.dispose;
const disposedTooltipPlaceholder = {
    activeTrigger: {},
    element: document.createElement("noscript")
};
TooltipProto.dispose = function () {
    originalDispose.call(this);
    // After disposal, set safe values so pending callbacks don't crash
    this._activeTrigger = disposedTooltipPlaceholder.activeTrigger;
    this._element = disposedTooltipPlaceholder.element;
};

export function useTooltip(elRef: RefObject<HTMLElement>, config: Partial<Tooltip.Options>) {
    useEffect(() => {
        if (!elRef?.current) return;

        const element = elRef.current;
        const $el = $(element);

        // Dispose any existing tooltip before creating a new one
        Tooltip.getInstance(element)?.dispose();
        $el.tooltip(config);

        // Capture the tooltip instance now, since elRef.current may be null during cleanup.
        const tooltip = Tooltip.getInstance(element);

        return () => {
            if (element.isConnected) {
                tooltip?.dispose();
            }
        };
    }, [ elRef, config ]);

    const showTooltip = useCallback(() => {
        if (!elRef?.current) return;

        const $el = $(elRef.current);
        $el.tooltip("show");
    }, [ elRef, config ]);

    const hideTooltip = useCallback(() => {
        if (!elRef?.current) return;

        const $el = $(elRef.current);
        $el.tooltip("hide");
    }, [ elRef ]);

    useDebugValue(config.title);

    return { showTooltip, hideTooltip };
}

const tooltips = new Set<Tooltip>();

/**
 * Similar to {@link useTooltip}, but doesn't expose methods to imperatively hide or show the tooltip.
 *
 * @param elRef the element to bind the tooltip to.
 * @param config optionally, the tooltip configuration.
 */
export function useStaticTooltip(elRef: RefObject<Element>, config?: Partial<Tooltip.Options>) {
    useEffect(() => {
        const hasTooltip = config?.title || elRef.current?.getAttribute("title");
        if (!elRef?.current || !hasTooltip) return;

        // Capture element now, since elRef.current may be null during cleanup.
        const element = elRef.current;

        // Dispose any existing tooltip before creating a new one
        Tooltip.getInstance(element)?.dispose();

        const tooltip = new Tooltip(element, config);
        element.addEventListener("show.bs.tooltip", () => {
            // Hide all the other tooltips.
            for (const otherTooltip of tooltips) {
                if (otherTooltip === tooltip) continue;
                otherTooltip.hide();
            }
        });
        tooltips.add(tooltip);

        return () => {
            tooltips.delete(tooltip);
            if (element.isConnected) {
                tooltip.dispose();
            }

            // For delegated (`selector:`) configs, hovered children spawn per-target
            // Tooltip instances whose popups the parent's dispose() does not remove;
            // sweep them here. Scope by walking the container's descendants that
            // still carry `aria-describedby` — Bootstrap stamps that attribute
            // while a tooltip is shown and clears it on hide, so the ids we find
            // point exactly at the currently-visible popups this delegated config
            // owns. A blanket `document.querySelectorAll(".tooltip")` would wipe
            // unrelated tooltips (e.g. CKEditor plugins') every time this hook's
            // effect re-runs — which is what caused the checkbox tooltip in
            // `TodoListMultistateEditing` to vanish whenever the "note saved" badge
            // transitioned states.
            if (config?.selector) {
                for (const target of element.querySelectorAll<HTMLElement>("[aria-describedby]")) {
                    const popupId = target.getAttribute("aria-describedby");
                    if (popupId) {
                        document.getElementById(popupId)?.remove();
                    }
                }
            }
        };
    }, [ elRef, config ]);
}

export function useStaticTooltipWithKeyboardShortcut(elRef: RefObject<Element>, title: string, actionName: KeyboardActionNames | undefined, opts?: Omit<Partial<Tooltip.Options>, "title">) {
    const [ keyboardShortcut, setKeyboardShortcut ] = useState<string[]>();
    useStaticTooltip(elRef, {
        title: keyboardShortcut?.length ? `${title} (${keyboardShortcut?.join(",")})` : title,
        ...opts
    });

    useEffect(() => {
        if (actionName) {
            keyboard_actions.getAction(actionName).then(action => setKeyboardShortcut(action?.effectiveShortcuts));
        }
    }, [actionName]);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function useLegacyImperativeHandlers(handlers: Record<string, Function>) {
    const parentComponent = useContext(ParentComponent);
    useEffect(() => {
        Object.assign(parentComponent as never, handlers);
    }, [ handlers ]);
}

export function useSyncedRef<T>(externalRef?: Ref<T>, initialValue: T | null = null): RefObject<T> {
    const ref = useRef<T>(initialValue);

    useEffect(() => {
        if (typeof externalRef === "function") {
            externalRef(ref.current);
        } else if (externalRef) {
            externalRef.current = ref.current;
        }
    }, [ ref, externalRef ]);

    return ref;
}

export function useImperativeSearchHighlighlighting(highlightedTokens: string[] | null | undefined) {
    const mark = useRef<Mark>();
    const highlightRegex = useMemo(() => {
        if (!highlightedTokens?.length) return null;
        const regex = highlightedTokens.map((token) => escapeRegExp(token)).join("|");
        return new RegExp(regex, "gi");
    }, [ highlightedTokens ]);

    return (el: HTMLElement | null | undefined) => {
        if (!el || !highlightRegex) return;

        if (!mark.current) {
            mark.current = new Mark(el);
        }

        mark.current.unmark();
        mark.current.markRegExp(highlightRegex, {
            element: "span",
            className: "ck-find-result"
        });
    };
}

export function useNoteTreeDrag(containerRef: MutableRef<HTMLElement | null | undefined>, { dragEnabled, dragNotEnabledMessage, callback }: {
    dragEnabled: boolean,
    dragNotEnabledMessage: Omit<ToastOptions, "id">;
    callback: (data: DragData[], e: DragEvent) => void
}) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function onDragEnter(e: DragEvent) {
            if (!dragEnabled) {
                toast.showPersistent({
                    ...dragNotEnabledMessage,
                    id: "drag-not-enabled",
                    timeout: 5000
                });
            }
        }

        function onDragOver(e: DragEvent) {
            e.preventDefault();
        }

        function onDrop(e: DragEvent) {
            toast.closePersistent("drag-not-enabled");
            if (!dragEnabled) {
                return;
            }

            const data = e.dataTransfer?.getData('text');
            if (!data) {
                return;
            }

            const parsedData = JSON.parse(data) as DragData[];
            if (!parsedData.length) {
                return;
            }

            callback(parsedData, e);
        }

        function onDragLeave() {
            toast.closePersistent("drag-not-enabled");
        }

        container.addEventListener("dragenter", onDragEnter);
        container.addEventListener("dragover", onDragOver);
        container.addEventListener("drop", onDrop);
        container.addEventListener("dragleave", onDragLeave);

        return () => {
            container.removeEventListener("dragenter", onDragEnter);
            container.removeEventListener("dragover", onDragOver);
            container.removeEventListener("drop", onDrop);
            container.removeEventListener("dragleave", onDragLeave);
        };
    }, [ containerRef, callback ]);
}

/**
 * Collection-specific wrapper around {@link useNoteTreeDrag}. It standardizes the drag-locked
 * message shared by every collection view and, when the collection hides archived notes, warns the
 * user after a drop that any archived notes were cloned in but stay hidden until "Show archived
 * notes" is enabled (otherwise the note silently has no effect on the view).
 *
 * The `callback` should return the IDs of the notes it actually added (cloned) to the collection so
 * the warning only mentions newly-copied notes, not ones that were already present.
 */
export function useCollectionTreeDrag(containerRef: MutableRef<HTMLElement | null | undefined>, { dragEnabled, includeArchived, callback }: {
    dragEnabled: boolean,
    includeArchived: boolean,
    callback: (data: DragData[], e: DragEvent) => string[] | Promise<string[]>
}) {
    const wrappedCallback = useCallback(async (data: DragData[], e: DragEvent) => {
        const addedNoteIds = await callback(data, e);
        if (!includeArchived && addedNoteIds?.length) {
            await warnIfArchivedNotesHidden(addedNoteIds);
        }
    }, [ includeArchived, callback ]);

    useNoteTreeDrag(containerRef, {
        dragEnabled,
        dragNotEnabledMessage: {
            icon: "bx bx-lock-alt",
            title: t("book.drag_locked_title"),
            message: t("book.drag_locked_message")
        },
        callback: wrappedCallback
    });
}

/** Toast a heads-up when freshly cloned notes are archived and the collection hides them. */
async function warnIfArchivedNotesHidden(addedNoteIds: string[]) {
    const notes = await froca.getNotes(addedNoteIds);
    const archivedCount = notes.filter((note) => note.isArchived).length;
    if (!archivedCount) {
        return;
    }
    toast.showMessage(t("book.archived_notes_hidden", { count: archivedCount }), 5000, "bx bx-archive");
}

/**
 * Long-press + contextmenu handler bundle. `contextmenu` covers desktop right-click and
 * Android Chrome long-press; explicit touch handlers cover iOS/WKWebView where
 * `contextmenu` doesn't fire on long-press.
 *
 * Returns props to spread onto the target element: `onContextMenu`, `onTouchStart`,
 * `onTouchMove`, `onTouchEnd`, `onTouchCancel`. When a long-press fires, the
 * follow-up synthesized click is suppressed via `preventDefault` on `touchend`.
 */
export function useLongPressContextMenu(handler: (e: MouseEvent) => void, holdMs = 400) {
    const timerRef = useRef<number | null>(null);
    const firedRef = useRef(false);

    const clear = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    useEffect(() => clear, [clear]);

    const onTouchStart = useCallback(
        (e: TouchEvent) => {
            firedRef.current = false;
            clear();
            const touch = e.touches[0];
            if (!touch) return;
            const pageX = touch.pageX;
            const pageY = touch.pageY;
            const target = e.target;
            timerRef.current = window.setTimeout(() => {
                firedRef.current = true;
                handler({
                    pageX,
                    pageY,
                    target,
                    preventDefault: () => {},
                    stopPropagation: () => {}
                } as unknown as MouseEvent);
            }, holdMs);
        },
        [handler, holdMs, clear]
    );

    const onTouchMove = useCallback(() => clear(), [clear]);

    const onTouchEnd = useCallback(
        (e: TouchEvent) => {
            clear();
            if (firedRef.current) {
                // Suppress the synthesized click that would otherwise follow touchend.
                e.preventDefault();
                firedRef.current = false;
            }
        },
        [clear]
    );

    return {
        onContextMenu: handler,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        onTouchCancel: clear
    };
}

export function useResizeObserver(ref: RefObject<HTMLElement>, callback: () => void) {
    const resizeObserver = useRef<ResizeObserver>(null);
    useEffect(() => {
        resizeObserver.current?.disconnect();
        const observer = new ResizeObserver(callback);
        resizeObserver.current = observer;

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, [ callback, ref ]);
}

export function useKeyboardShortcuts(scope: "code-detail" | "text-detail", containerRef: RefObject<HTMLElement>, parentComponent: Component | undefined, ntxId: string | null | undefined) {
    useEffect(() => {
        if (!parentComponent) return;
        const $container = refToJQuerySelector(containerRef);
        const bindingPromise = keyboard_actions.setupActionsForElement(scope, $container, parentComponent, ntxId);
        return async () => {
            const bindings = await bindingPromise;
            for (const binding of bindings) {
                removeIndividualBinding(binding);
            }
        };
    }, [ scope, containerRef, parentComponent, ntxId ]);
}

/**
 * Register a global shortcut. Internally it uses the shortcut service and assigns a random namespace to make it unique.
 *
 * @param keyboardShortcut the keyboard shortcut combination to register.
 * @param handler the corresponding handler to be called when the keyboard shortcut is invoked by the user.
 */
export function useGlobalShortcut(keyboardShortcut: string | null | undefined, handler: Handler) {
    useEffect(() => {
        if (!keyboardShortcut) return;
        const namespace = randomString(10);
        shortcuts.bindGlobalShortcut(keyboardShortcut, handler, namespace);
        return () => shortcuts.removeGlobalShortcut(namespace);
    }, [ keyboardShortcut, handler ]);
}

/**
 * Indicates that the current note is in read-only mode, while an editing mode is available,
 * and provides a way to switch to editing mode.
 */
export function useIsNoteReadOnly(note: FNote | null | undefined, noteContext: NoteContext | undefined) {
    const [ isReadOnly, setIsReadOnly ] = useState<boolean | undefined>(undefined);
    const [ readOnlyAttr ] = useNoteLabelBoolean(note, "readOnly");
    const [ autoReadOnlyDisabledAttr ] = useNoteLabelBoolean(note, "autoReadOnlyDisabled");
    const [ temporarilyEditable, setTemporarilyEditable ] = useState(false);

    const enableEditing = useCallback((enabled = true) => {
        if (noteContext?.viewScope) {
            noteContext.viewScope.readOnlyTemporarilyDisabled = enabled;
            appContext.triggerEvent("readOnlyTemporarilyDisabled", {noteContext});
            setTemporarilyEditable(enabled);
        }
    }, [noteContext]);

    useEffect(() => {
        if (note && noteContext) {
            isNoteReadOnly(note, noteContext).then((readOnly) => {
                setIsReadOnly(readOnly);
                setTemporarilyEditable(false);
            });
        }
    }, [ note, noteContext, noteContext?.viewScope, readOnlyAttr, autoReadOnlyDisabledAttr ]);

    useTriliumEvent("readOnlyTemporarilyDisabled", ({noteContext: eventNoteContext}) => {
        if (noteContext?.ntxId === eventNoteContext.ntxId) {
            setIsReadOnly(!noteContext.viewScope?.readOnlyTemporarilyDisabled);
            setTemporarilyEditable(true);
        }
    });

    return { isReadOnly, enableEditing, temporarilyEditable };
}

/**
 * Synchronous effective read-only state for widgets that honor the `#readOnly` label
 * (mermaid, canvas, mind map, spreadsheet). Combines the label with the temporary
 * "enable editing" toggle (driven by `readOnlyTemporarilyDisabled`) so clicking the
 * read-only badge unlocks the widget.
 */
export function useEffectiveReadOnly(note: FNote | null | undefined, noteContext: NoteContext | undefined) {
    const [ readOnlyLabel ] = useNoteLabelBoolean(note, "readOnly");
    const [ tempDisabled, setTempDisabled ] = useState<boolean>(!!noteContext?.viewScope?.readOnlyTemporarilyDisabled);

    useEffect(() => {
        setTempDisabled(!!noteContext?.viewScope?.readOnlyTemporarilyDisabled);
    }, [ note, noteContext, noteContext?.viewScope ]);

    useTriliumEvent("readOnlyTemporarilyDisabled", ({ noteContext: eventNoteContext }) => {
        if (noteContext?.ntxId === eventNoteContext?.ntxId) {
            setTempDisabled(!!eventNoteContext?.viewScope?.readOnlyTemporarilyDisabled);
        }
    });

    return readOnlyLabel && !tempDisabled;
}

async function isNoteReadOnly(note: FNote, noteContext: NoteContext) {

    if (note.isProtected && !protected_session_holder.isProtectedSessionAvailable()) {
        return false;
    }

    if (options.is("databaseReadonly")) {
        return false;
    }

    if (noteContext.viewScope?.viewMode !== "default" || !await noteContext.isReadOnly()) {
        return false;
    }

    return true;
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

    if (note?.noteId === noteId) {
        return note;
    }
    return undefined;
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

export function useTextEditor(noteContext: NoteContext | null | undefined) {
    const [ textEditor, setTextEditor ] = useState<CKTextEditor | null>(null);
    const requestIdRef = useRef(0);

    // React to note context change and initial state.
    useEffect(() => {
        if (!noteContext) {
            setTextEditor(null);
            return;
        }

        const requestId = ++requestIdRef.current;
        noteContext.getTextEditor((textEditor) => {
            // Prevent stale async.
            if (requestId !== requestIdRef.current) return;
            setTextEditor(textEditor);
        });
    }, [ noteContext ]);

    // React to editor initializing.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (eventNtxId !== noteContext?.ntxId) return;
        setTextEditor(editor);
    });

    return textEditor;
}

export function useContentElement(noteContext: NoteContext | null | undefined) {
    const [ contentElement, setContentElement ] = useState<HTMLElement | null>(null);
    const requestIdRef = useRef(0);
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        noteContext?.getContentElement().then(contentElement => {
            // Prevent stale async.
            if (!contentElement || requestId !== requestIdRef.current) return;
            setContentElement(contentElement?.[0] ?? null);
            forceUpdate(v => v + 1);
        });
    }, [ noteContext ]);

    // React to content changes initializing.
    useTriliumEvent("contentElRefreshed", ({ ntxId: eventNtxId, contentEl }) => {
        if (eventNtxId !== noteContext?.ntxId) return;
        setContentElement(contentEl);
        forceUpdate(v => v + 1);
    });

    return contentElement;
}

/**
 * Set context data on the current note context.
 * This allows type widgets to publish data (e.g., table of contents, PDF pages)
 * that can be consumed by sidebar/toolbar components.
 *
 * Data is automatically cleared when navigating to a different note.
 *
 * @param key - Unique identifier for the data type (e.g., "toc", "pdfPages")
 * @param value - The data to publish
 *
 * @example
 * // In a PDF viewer widget:
 * const { noteContext } = useActiveNoteContext();
 * useSetContextData(noteContext, "pdfPages", pages);
 */
export function useSetContextData<K extends keyof NoteContextDataMap>(
    noteContext: NoteContext | null | undefined,
    key: K,
    value: NoteContextDataMap[K] | undefined
) {
    useEffect(() => {
        if (!noteContext) return;

        if (value !== undefined) {
            noteContext.setContextData(key, value);
        } else {
            noteContext.clearContextData(key);
        }

        return () => {
            noteContext.clearContextData(key);
        };
    }, [noteContext, key, value]);
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

/**
 * Get context data from a specific note context (not necessarily the active one).
 *
 * @param noteContext - The specific note context to get data from
 * @param key - The data key to retrieve
 * @returns The current data, or undefined if not available
 */
export function useGetContextDataFrom<K extends keyof NoteContextDataMap>(
    noteContext: NoteContext | null | undefined,
    key: K
): NoteContextDataMap[K] | undefined {
    const [data, setData] = useState<NoteContextDataMap[K] | undefined>(() =>
        noteContext?.getContextData(key)
    );

    // Update initial value when noteContext changes
    useEffect(() => {
        setData(noteContext?.getContextData(key));
    }, [noteContext, key]);

    // Subscribe to changes via Trilium event system
    useTriliumEvent("contextDataChanged", ({ noteContext: eventNoteContext, key: changedKey, value }) => {
        if (eventNoteContext === noteContext && changedKey === key) {
            setData(value as NoteContextDataMap[K]);
        }
    });

    return data;
}

/** The effective light/dark style, updated on any theme change — a theme-option swap or, for auto themes, the
 *  OS light/dark flip (both delivered via the global `themeChanged` event). */
export function useColorScheme() {
    const [ themeStyle, setThemeStyle ] = useState(getEffectiveThemeStyle);
    useTriliumEvent("themeChanged", ({ themeStyle }) => setThemeStyle(themeStyle));
    return themeStyle;
}

/**
 * Renders math equations within elements that have the `.math-tex` class.
 * Used by sidebar widgets like Table of Contents and Highlights list to display math content.
 *
 * @param containerRef - Ref to the container element that may contain math elements
 * @param deps - Dependencies that trigger re-rendering (e.g., text content)
 */
export function useMathRendering(containerRef: RefObject<HTMLElement>, deps: unknown[]) {
    useEffect(() => {
        if (!containerRef.current) return;
        const mathElements = containerRef.current.querySelectorAll(".math-tex");
        if (!mathElements.length) return;

        // KaTeX is heavy, so the math service is only loaded once there are equations to render.
        void import("../../services/math").then(({ default: math }) => {
            for (const mathEl of mathElements) {
                // Skip if already rendered by KaTeX
                if (mathEl.querySelector(".katex")) continue;

                try {
                    // CKEditor's data format wraps the equation with \(...\) or \[...\]
                    // delimiters. katex.render() expects raw LaTeX without them.
                    const raw = mathEl.textContent?.trim() ?? "";
                    let equation: string;
                    let displayMode = false;

                    if (raw.startsWith("\\(") && raw.endsWith("\\)")) {
                        equation = raw.slice(2, -2);
                    } else if (raw.startsWith("\\[") && raw.endsWith("\\]")) {
                        equation = raw.slice(2, -2);
                        displayMode = true;
                    } else {
                        equation = raw;
                    }

                    // throwOnError: false renders invalid formulas as an inline red error
                    // instead of throwing (the catch below stays as a final safety net).
                    math.render(equation, mathEl as HTMLElement, { displayMode, throwOnError: false });
                } catch (e) {
                    console.warn("Failed to render math:", e);
                }
            }
        });
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Keeps navigation that follows internal note links (note links, reference links, "Related settings",
 * etc.) inside a popup dialog — whose note context lives outside the tab manager — instead of letting
 * the global link handler resolve to the active tab in the background. The dialog decides what to do
 * with the parsed target via `onNavigate` (typically `noteContext.setNote()` or routing to another
 * dialog).
 *
 * The listener is attached to `containerRef` in the capture phase so it runs before the
 * document-level `goToLink` handler (and before anything that might stop propagation). Modified or
 * middle clicks and external links are left untouched so they can still open in a new tab/window or
 * externally, and clicks inside editable rich text are ignored so they keep placing the caret.
 * Links that implement their own navigation (and would otherwise never see the click, since this
 * runs first) can opt out entirely via a `data-no-contained-navigation` attribute.
 */
export function useContainedLinkNavigation(
    containerRef: RefObject<HTMLElement>,
    onNavigate: (notePath: string, viewScope: ViewScope | undefined) => void
) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        function onClick(e: MouseEvent) {
            if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            const link = (e.target as HTMLElement).closest("a");
            if (!link || link.getAttribute("target") === "_blank" || link.isContentEditable) return;
            if (link.hasAttribute("data-no-contained-navigation")) return;

            const href = link.getAttribute("href") ?? link.getAttribute("data-href");
            if (!href?.startsWith("#root/")) return; // external links / in-page anchors handled elsewhere

            const { notePath, viewScope } = parseNavigationStateFromUrl(href);
            if (!notePath) return;

            e.preventDefault();
            e.stopPropagation();
            // A double-click also fires a separate `dblclick` event that the global handler in
            // link.ts treats as "open in a new tab", which would navigate away and dismiss the
            // surrounding dialog. The preceding `click` already navigated, so for `dblclick` we
            // only need to swallow the event and skip the redundant navigation.
            if (e.type !== "dblclick") {
                onNavigate(notePath, viewScope);
            }
        }

        container.addEventListener("click", onClick, true);
        container.addEventListener("dblclick", onClick, true);
        return () => {
            container.removeEventListener("click", onClick, true);
            container.removeEventListener("dblclick", onClick, true);
        };
    }, [ containerRef, onNavigate ]);
}

export type DelayedVisibilityPhase = "hidden" | "visible" | "stalled";

export interface DelayedVisibilityOpts {
    /** The indicator is never shown if `active` clears within this window (fast loads never flash). */
    graceMs?: number;
    /** Once shown, the indicator stays at least this long, even if `active` clears sooner (no two-frame flicker). */
    minVisibleMs?: number;
    /** After this much continuous activity the phase escalates to "stalled" so the UI can offer a retry. */
    stalledMs?: number;
}

/**
 * Drives a flicker-free loading indicator from a boolean "is loading" signal:
 *
 * - **grace period**: nothing is shown if loading finishes within {@link DelayedVisibilityOpts.graceMs},
 *   so fast loads never flash a loading state;
 * - **minimum visibility**: once shown, the indicator stays for at least
 *   {@link DelayedVisibilityOpts.minVisibleMs}, preventing a skeleton that appears for two frames;
 * - **escalation**: after {@link DelayedVisibilityOpts.stalledMs} of continuous loading the phase
 *   becomes `"stalled"`, letting the UI switch to a "still loading / retry" presentation.
 */
export function useDelayedVisibility(active: boolean, { graceMs = 150, minVisibleMs = 280, stalledMs = 8000 }: DelayedVisibilityOpts = {}): DelayedVisibilityPhase {
    const [ phase, setPhase ] = useState<DelayedVisibilityPhase>("hidden");
    const shownAtRef = useRef(0);

    useEffect(() => {
        if (active) {
            if (phase === "hidden") {
                const graceTimer = setTimeout(() => {
                    shownAtRef.current = Date.now();
                    setPhase("visible");
                }, graceMs);
                return () => clearTimeout(graceTimer);
            }

            if (phase === "visible") {
                const stalledTimer = setTimeout(
                    () => setPhase("stalled"),
                    Math.max(0, shownAtRef.current + stalledMs - Date.now())
                );
                return () => clearTimeout(stalledTimer);
            }
        } else if (phase !== "hidden") {
            const hideTimer = setTimeout(
                () => setPhase("hidden"),
                Math.max(0, shownAtRef.current + minVisibleMs - Date.now())
            );
            return () => clearTimeout(hideTimer);
        }
    }, [ active, phase, graceMs, minVisibleMs, stalledMs ]);

    return phase;
}
