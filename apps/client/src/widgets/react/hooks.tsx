import { useCallback, useContext, useDebugValue, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { EventData, EventNames } from "../../components/app_context";
import { ParentComponent } from "./react_utils";
import SpacedUpdate from "../../services/spaced_update";
import { OptionNames } from "@triliumnext/commons";
import options, { type OptionValue } from "../../services/options";
import utils, { reloadFrontendApp } from "../../services/utils";
import NoteContext from "../../components/note_context";
import BasicWidget, { ReactWrappedWidget } from "../basic_widget";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import FBlob from "../../entities/fblob";
import NoteContextAwareWidget from "../note_context_aware_widget";
import { RefObject, VNode } from "preact";
import { Tooltip } from "bootstrap";
import { CSSProperties } from "preact/compat";

export function useTriliumEvent<T extends EventNames>(eventName: T, handler: (data: EventData<T>) => void) {
    const parentComponent = useContext(ParentComponent);
    useEffect(() => {
        parentComponent?.registerHandler(eventName, handler);
        return (() => parentComponent?.removeHandler(eventName, handler));
    }, [ eventName, handler ]);
    useDebugValue(eventName);
}

export function useTriliumEvents<T extends EventNames>(eventNames: T[], handler: (data: EventData<T>, eventName: T) => void) {
    const parentComponent = useContext(ParentComponent);
    
    useEffect(() => {
        const handlers: ({ eventName: T, callback: (data: EventData<T>) => void })[] = [];
        for (const eventName of eventNames) {
            handlers.push({ eventName, callback: (data) => {
                handler(data, eventName);
            }})
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

export function useSpacedUpdate(callback: () => void | Promise<void>, interval = 1000) {
    const callbackRef = useRef(callback);
    const spacedUpdateRef = useRef<SpacedUpdate>();

    // Update callback ref when it changes
    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    // Create SpacedUpdate instance only once
    if (!spacedUpdateRef.current) {
        spacedUpdateRef.current = new SpacedUpdate(
            () => callbackRef.current(),
            interval
        );
    }

    // Update interval if it changes
    useEffect(() => {
        spacedUpdateRef.current?.setUpdateInterval(interval);
    }, [interval]);

    return spacedUpdateRef.current;
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
            await options.save(name, newValue);

            if (needsRefresh) {
                reloadFrontendApp(`option change: ${name}`);
            }
        }
    }, [ name, needsRefresh ]);

    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        if (loadResults.getOptionNames().includes(name)) {
            const newValue = options.get(name);
            setValue(newValue);
        }
     }, [ name ]));

    useDebugValue(name);

    return [
        value,
        wrappedSetValue
    ]
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
    ]
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
    ]
}

/**
 * Similar to {@link useTriliumOption}, but the object value is parsed to and from a JSON instead of a string.
 * 
 * @param name the name of the option to listen for.
 * @returns an array where the first value is the current option value and the second value is the setter.
 */
export function useTriliumOptionJson<T>(name: OptionNames): [ T, (newValue: T) => Promise<void> ] {
    const [ value, setValue ] = useTriliumOption(name);
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
    return useMemo(() => (prefix ? prefix + "-" : "") + utils.randomString(10), [ prefix ]);
}

export function useNoteContext() {

    const [ noteContext, setNoteContext ] = useState<NoteContext>();
    const [ notePath, setNotePath ] = useState<string | null | undefined>();
    const [ note, setNote ] = useState<FNote | null | undefined>(); 

    useEffect(() => {
        setNote(noteContext?.note);
    }, [ notePath ]);

    useTriliumEvent("activeContextChanged", ({ noteContext }) => {
        setNoteContext(noteContext);
        setNotePath(noteContext.notePath);        
    });
    useTriliumEvent("noteSwitchedAndActivated", ({ noteContext }) => {
        setNoteContext(noteContext);
    });
    useTriliumEvent("noteSwitched", ({ notePath }) => {
        setNotePath(notePath);
    });
    useTriliumEvent("frocaReloaded", () => {
        setNote(noteContext?.note);
    });

    const parentComponent = useContext(ParentComponent) as ReactWrappedWidget;
    (parentComponent as ReactWrappedWidget & { setNoteContextEvent: (data: EventData<"setNoteContext">) => void }).setNoteContextEvent = ({ noteContext }: EventData<"setNoteContext">) => {
        setNoteContext(noteContext);
    }

    useDebugValue(() => `notePath=${notePath}, ntxId=${noteContext?.ntxId}`);
    

    return {
        note: note,
        noteId: noteContext?.note?.noteId,
        notePath: noteContext?.notePath,
        hoistedNoteId: noteContext?.hoistedNoteId,
        ntxId: noteContext?.ntxId,
        viewScope: noteContext?.viewScope,
        componentId: parentComponent.componentId,
        noteContext,
        parentComponent
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

export function useNoteRelation(note: FNote | undefined | null, relationName: string): [string | null | undefined, (newValue: string) => void] {
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
            attributes.setAttribute(note, "relation", relationName, value)
        }
    }, [note]);

    useDebugValue(relationName);

    return [
        relationValue,
        setter
    ] as const;
}

/**
 * Allows a React component to read or write a note's label while also reacting to changes in value.
 * 
 * @param note the note whose label to read/write.
 * @param labelName the name of the label to read/write.
 * @returns an array where the first element is the getter and the second element is the setter. The setter has a special behaviour for convenience: if the value is undefined, the label is created without a value (e.g. a tag), if the value is null then the label is removed.
 */
export function useNoteLabel(note: FNote | undefined | null, labelName: string): [string | null | undefined, (newValue: string | null | undefined) => void] {
    const [ labelValue, setLabelValue ] = useState<string | null | undefined>(note?.getLabelValue(labelName));

    useEffect(() => setLabelValue(note?.getLabelValue(labelName) ?? null), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "label" && attr.name === labelName && attributes.isAffecting(attr, note)) {
                setLabelValue(attr.value ?? null);
            }
        }
    });

    const setter = useCallback((value: string | null | undefined) => {
        if (note) {
            if (value || value === undefined) {
                attributes.setLabel(note.noteId, labelName, value)
            } else if (value === null) {
                attributes.removeOwnedLabelByName(note, labelName);
            }
        }
    }, [note]);

    useDebugValue(labelName);

    return [
        labelValue,
        setter
    ] as const;
}

export function useNoteLabelBoolean(note: FNote | undefined | null, labelName: string): [ boolean, (newValue: boolean) => void] {
    const [ labelValue, setLabelValue ] = useState<boolean>(!!note?.hasLabel(labelName));

    useEffect(() => setLabelValue(!!note?.hasLabel(labelName)), [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        for (const attr of loadResults.getAttributeRows()) {
            if (attr.type === "label" && attr.name === labelName && attributes.isAffecting(attr, note)) {
                setLabelValue(!attr.isDeleted);
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

    return [ labelValue, setter ] as const;
}

export function useNoteBlob(note: FNote | null | undefined): [ FBlob | null | undefined ] {
    const [ blob, setBlob ] = useState<FBlob | null>();
    
    function refresh() {
        note?.getBlob().then(setBlob);        
    }

    useEffect(refresh, [ note?.noteId ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.hasRevisionForNote(note.noteId)) {
            refresh();
        }
    });

    useDebugValue(note?.noteId);

    return [ blob ] as const;
}

export function useLegacyWidget<T extends BasicWidget>(widgetFactory: () => T, { noteContext, containerClassName, containerStyle }: {
    noteContext?: NoteContext;
    containerClassName?: string;
    containerStyle?: CSSProperties;
} = {}): [VNode, T] {
    const ref = useRef<HTMLDivElement>(null);
    const parentComponent = useContext(ParentComponent);

    // Render the widget once.
    const [ widget, renderedWidget ] = useMemo(() => {
        const widget = widgetFactory();

        if (parentComponent) {
            parentComponent.child(widget);
        }

        if (noteContext && widget instanceof NoteContextAwareWidget) {
            widget.setNoteContextEvent({ noteContext });
        }
        
        const renderedWidget = widget.render();
        return [ widget, renderedWidget ];
    }, []);

    // Attach the widget to the parent.
    useEffect(() => {
        if (ref.current) {
            ref.current.innerHTML = "";
            renderedWidget.appendTo(ref.current);
        }
    }, [ renderedWidget ]);

    // Inject the note context.
    useEffect(() => {
        if (noteContext && widget instanceof NoteContextAwareWidget) {
            widget.activeContextChangedEvent({ noteContext });
        }
    }, [ noteContext ]);

    useDebugValue(widget);

    return [ <div className={containerClassName} style={containerStyle} ref={ref} />, widget ]
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
        }
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
        console.log("Show tooltip ", elRef.current);
    }, [ elRef, config ]);

    const hideTooltip = useCallback(() => {
        if (!elRef?.current) return;

        const $el = $(elRef.current);
        $el.tooltip("hide");
    }, [ elRef ]);

    useDebugValue(config.title);

    return { showTooltip, hideTooltip };
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