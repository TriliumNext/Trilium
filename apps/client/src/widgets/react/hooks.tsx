import { CKTextEditor } from "@triliumnext/ckeditor5";
import { FilterLabelsByType, KeyboardActionNames, NoteType, OptionNames, RelationNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import Mark from "mark.js";
import { RefObject, VNode } from "preact";
import { CSSProperties, useSyncExternalStore } from "preact/compat";
import { MutableRef, useCallback, useContext, useDebugValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext, { EventData, EventNames } from "../../components/app_context";
import Component from "../../components/component";
import NoteContext, { NoteContextDataMap } from "../../components/note_context";
import FBlob from "../../entities/fblob";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import keyboard_actions from "../../services/keyboard_actions";
import { ViewScope } from "../../services/link";
import options, { type OptionValue } from "../../services/options";
import protected_session_holder from "../../services/protected_session_holder";
import server from "../../services/server";
import shortcuts, { Handler, removeIndividualBinding } from "../../services/shortcuts";
import SpacedUpdate, { type StateCallback } from "../../services/spaced_update";
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
        const handlers: ({ eventName: T, callback: (data: EventData<T>) => void })[] = [];
        for (const eventName of eventNames) {
            handlers.push({ eventName, callback: (data) => {
                handler(data, eventName);
            }});
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
    }[];
}

export function useEditorSpacedUpdate({ note, noteType, noteContext, getData, onContentChange, dataSaved, updateInterval }: {
    noteType: NoteType;
    note: FNote,
    noteContext: NoteContext | null | undefined,
    getData: () => Promise<SavedData | undefined> | SavedData | undefined,
    onContentChange: (newContent: string) => void,
    dataSaved?: (savedData: SavedData) => void,
    updateInterval?: number;
}) {
    const parentComponent = useContext(ParentComponent);
    const blob = useNoteBlob(note, parentComponent?.componentId);

    const callback = useMemo(() => {
        return async () => {
            const data = await getData();

            // for read only notes
            if (data === undefined || note.type !== noteType) return;

            protected_session_holder.touchProtectedSessionIfNecessary(note);

            await server.put(`notes/${note.noteId}/data`, data, parentComponent?.componentId);

            noteSavedDataStore.set(note.noteId, data.content);
            dataSaved?.(data);
        };
    }, [ note, getData, dataSaved, noteType, parentComponent ]);
    const stateCallback = useCallback<StateCallback>((state) => {
        noteContext?.setContextData("saveState", {
            state
        });
    }, [ noteContext ]);
    const spacedUpdate = useSpacedUpdate(callback, updateInterval, stateCallback);

    // React to note/blob changes.
    useEffect(() => {
        if (!blob) return;
        noteSavedDataStore.set(note.noteId, blob.content);
        spacedUpdate.allowUpdateWithoutChange(() => onContentChange(blob.content));
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
    const noteContextContext = useContext(NoteContextContext);
    const [ noteContext, setNoteContext ] = useState<NoteContext | undefined>(noteContextContext ?? undefined);
    const [ notePath, setNotePath ] = useState<string | null | undefined>();
    const [ note, setNote ] = useState<FNote | null | undefined>();
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
        if (noteContextContext) return;
        setNoteContext(noteContext);
        setHoistedNoteId(noteContext.hoistedNoteId);
        setNotePath(noteContext.notePath);
        setViewScope(noteContext.viewScope);
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

    const parentComponent = useContext(ParentComponent) as ReactWrappedWidget;
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
                setRelationValue(attr.value ?? null);
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
            if (value) {
                attributes.setLabel(note.noteId, labelName, "");
            } else {
                attributes.removeOwnedLabelByName(note, labelName);
            }
        }
    }, [note]);

    useDebugValue(labelName);

    const labelValue = !!note?.hasLabel(labelName);
    return [ labelValue, setter ] as const;
}

export function useNoteLabelInt(note: FNote | undefined | null, labelName: FilterLabelsByType<number>): [ number | undefined, (newValue: number) => void] {
    //@ts-expect-error `useNoteLabel` only accepts string properties but we need to be able to read number ones.
    const [ value, setValue ] = useNoteLabel(note, labelName);
    useDebugValue(labelName);
    return [
        (value ? parseInt(value, 10) : undefined),
        (newValue) => setValue(String(newValue))
    ];
}

export function useNoteBlob(note: FNote | null | undefined, componentId?: string): FBlob | null | undefined {
    const [ blob, setBlob ] = useState<FBlob | null>();
    const requestIdRef = useRef(0);

    async function refresh() {
        const requestId = ++requestIdRef.current;
        const newBlob = await note?.getBlob();

        // Only update if this is the latest request.
        if (requestId === requestIdRef.current) {
            setBlob(newBlob);
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

export function useTooltip(elRef: RefObject<HTMLElement>, config: Partial<Tooltip.Options>) {
    useEffect(() => {
        if (!elRef?.current) return;

        const $el = $(elRef.current);
        $el.tooltip("dispose");
        $el.tooltip(config);
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

        const tooltip = Tooltip.getOrCreateInstance(elRef.current, config);
        elRef.current.addEventListener("show.bs.tooltip", () => {
            // Hide all the other tooltips.
            for (const otherTooltip of tooltips) {
                if (otherTooltip === tooltip) continue;
                otherTooltip.hide();
            }
        });
        tooltips.add(tooltip);

        return () => {
            tooltips.delete(tooltip);
            tooltip.dispose();
            // workaround for https://github.com/twbs/bootstrap/issues/37474
            (tooltip as any)._activeTrigger = {};
            (tooltip as any)._element = document.createElement('noscript'); // placeholder with no behavior

            // Remove *all* tooltip elements from the DOM
            document
                .querySelectorAll('.tooltip')
                .forEach(t => t.remove());
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

export function useSyncedRef<T>(externalRef?: RefObject<T>, initialValue: T | null = null): RefObject<T> {
    const ref = useRef<T>(initialValue);

    useEffect(() => {
        if (externalRef) {
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

