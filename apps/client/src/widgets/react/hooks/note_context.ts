import type { CKTextEditor } from "@triliumnext/ckeditor5";
import {
    useCallback, useContext, useDebugValue, useEffect, useLayoutEffect, useRef, useState
} from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type { NoteContextDataMap } from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import type { ViewScope } from "../../../services/link";
import options from "../../../services/options";
import protected_session_holder from "../../../services/protected_session_holder";
import { consumeSearchTerms } from "../../../services/search_jump";
import type { ReactWrappedWidget } from "../../basic_widget";
import { findClosestNoteContext, NoteContextContext, ParentComponent } from "../react_utils";
import { useTriliumEvent, useTriliumEvents } from "./events";
import { useNoteLabelBoolean } from "./note";

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

    useTriliumEvents([ "setNoteContext", "activeContextChanged", "noteSwitchedAndActivated", "noteSwitched" ], ({ noteContext }) => {
        // When bound to a specific context via the provider (the quick-edit popup), ignore events for
        // other contexts, but still react when our own bound context navigates in place (e.g. switching
        // settings pages from the in-popup selector) — otherwise the popup would stay on the first page.
        if (noteContextContext && noteContext !== noteContextContext) return;
        setNoteContext(noteContext);
        setHoistedNoteId(noteContext.hoistedNoteId);
        setNotePath(noteContext.notePath);
        // With the path, so the first render on the new note context already has its note.
        setNote(noteContext.note);
        setViewScope(noteContext.viewScope);
        // Navigating resets the view scope, so the temporary "enable editing" toggle must be reset too.
        // Otherwise the stale value prevents consumers from refreshing when the user
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
 * Registers `noteContext`, built outside the tab row, with `TabManager` for as long as the component
 * uses it, so that commands naming its `ntxId` resolve to it.
 */
export function useDetachedNoteContext(noteContext: NoteContext) {
    useEffect(() => {
        appContext.tabManager.registerDetachedContext(noteContext);
        return () => appContext.tabManager.unregisterDetachedContext(noteContext);
    }, [ noteContext ]);
}

/**
 * Calls `consumeSearchTerms` when a search result is re-clicked while its note is already open.
 * That switch does not change the blob, so the widget's own content-ready path does not re-run.
 * The switch must target the note this widget shows: a switch to a different note belongs to the
 * newly mounted widget, and consuming it here would clear the terms before its content is ready.
 */
export function useSearchTermsConsumer(note: FNote | null | undefined, noteContext: NoteContext | undefined, ntxId: string | null | undefined) {
    useTriliumEvent("noteSwitched", ({ noteContext: switchedContext }) => {
        if (switchedContext.ntxId !== ntxId) return;
        if (switchedContext.note?.noteId !== note?.noteId) return;
        consumeSearchTerms(noteContext, ntxId);
    });
}

/**
 * Calls `callback` when the note context `ntxId` switches to `note`, the note the widget shows
 * already, as when a link to a part of the open note is followed.
 */
export function useSameNoteSwitch(
    note: FNote | null | undefined,
    ntxId: string | null | undefined,
    callback: () => void
) {
    useTriliumEvent("noteSwitched", ({ noteContext }) => {
        if (noteContext.ntxId === ntxId && noteContext.note?.noteId === note?.noteId) {
            callback();
        }
    });
}

/** The widget that {@link useLinkTargetLanding} lands the links in. */
export interface LandingWidget {
    /** The note that the widget shows. */
    note: FNote | null | undefined;
    ntxId: string | null | undefined;
    /** False while `NoteDetail` keeps the widget mounted but the pane shows another one. */
    isVisible?: boolean;
}

/**
 * Lands on the target of a link to the note that the widget shows: calls `land` after a render
 * that changes `contentDeps` or shows the widget, and on a switch to the same note
 * (`useSameNoteSwitch()`). A hidden widget leaves the target to the one on display. While the
 * content does not show the note, `land` leaves the target in the view scope for a later call.
 */
export function useLinkTargetLanding(
    { note, ntxId, isVisible }: LandingWidget,
    land: () => void,
    contentDeps: unknown[] = []
) {
    useEffect(() => {
        if (isVisible !== false) land();
    }, [ ...contentDeps, isVisible ]);
    useSameNoteSwitch(note, ntxId, () => {
        if (isVisible !== false) land();
    });
}

/**
 * Indicates that the current note is in read-only mode, while an editing mode is available,
 * and provides a way to switch to editing mode. `isLocked` marks a note that no editing mode can
 * unlock, as its content cannot be saved; `enableEditing` does nothing for it.
 */
export function useIsNoteReadOnly(note: FNote | null | undefined, noteContext: NoteContext | undefined) {
    const [ isReadOnly, setIsReadOnly ] = useState<boolean | undefined>(undefined);
    const [ readOnlyAttr ] = useNoteLabelBoolean(note, "readOnly");
    const [ autoReadOnlyDisabledAttr ] = useNoteLabelBoolean(note, "autoReadOnlyDisabled");
    const [ temporarilyEditable, setTemporarilyEditable ] = useState(false);
    const isLocked = note?.isContentWritable === false;

    const enableEditing = useCallback((enabled = true) => {
        if (noteContext?.viewScope && !isLocked) {
            noteContext.viewScope.readOnlyTemporarilyDisabled = enabled;
            appContext.triggerEvent("readOnlyTemporarilyDisabled", {noteContext});
            setTemporarilyEditable(enabled);
        }
    }, [noteContext, isLocked]);

    useEffect(() => {
        if (note && noteContext) {
            isNoteReadOnly(note, noteContext).then((readOnly) => {
                setIsReadOnly(readOnly);
                setTemporarilyEditable(false);
            });
        }
    }, [ note, noteContext, noteContext?.viewScope, readOnlyAttr, autoReadOnlyDisabledAttr ]);

    useTriliumEvent("readOnlyTemporarilyDisabled", ({noteContext: eventNoteContext}) => {
        if (noteContext?.ntxId === eventNoteContext.ntxId && !isLocked) {
            setIsReadOnly(!noteContext.viewScope?.readOnlyTemporarilyDisabled);
            setTemporarilyEditable(true);
        }
    });

    return { isReadOnly, isLocked, enableEditing, temporarilyEditable };
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

/**
 * State of the document `documentKey`, such as the note a context shows: `initialValue` from the
 * render where the key changes, and the value of an earlier key is discarded, so coming back to
 * that document does not bring it back. `initialValue` must keep its identity across renders.
 */
export function useDocumentState<T>(
    documentKey: string, initialValue: T
): [ T, (update: (previous: T) => T) => void ] {
    const [ state, setState ] = useState({ documentKey, value: initialValue });
    const value = state.documentKey === documentKey ? state.value : initialValue;

    useLayoutEffect(() => {
        setState((previous) => (previous.documentKey === documentKey
            ? previous
            : { documentKey, value: initialValue }));
    }, [ documentKey, initialValue ]);

    const update = useCallback((updater: (previous: T) => T) => {
        setState((previous) => ({
            documentKey,
            value: updater(previous.documentKey === documentKey ? previous.value : initialValue)
        }));
    }, [ documentKey, initialValue ]);

    return [ value, update ];
}

/** A value looked up for a note context, kept with that context. */
interface ResolvedValue<T> {
    noteContext: NoteContext | null | undefined;
    value: T;
}

/** `previous` when `next` holds the same, so that setting it does not re-render. */
function keepIfSame<T>(previous: ResolvedValue<T>, next: ResolvedValue<T>) {
    return previous.noteContext === next.noteContext && previous.value === next.value
        ? previous
        : next;
}

/** The text editor of `noteContext`, or `null` while it is looked up. */
export function useTextEditor(noteContext: NoteContext | null | undefined) {
    const [ resolved, setResolved ] = useState<ResolvedValue<CKTextEditor | null>>({
        noteContext, value: null
    });
    const requestIdRef = useRef(0);

    // React to note context change and initial state.
    useEffect(() => {
        if (!noteContext) {
            setResolved((previous) => keepIfSame(previous, { noteContext, value: null }));
            return;
        }

        const requestId = ++requestIdRef.current;
        noteContext.getTextEditor((textEditor) => {
            // Prevent stale async.
            if (requestId !== requestIdRef.current) return;
            setResolved((previous) => keepIfSame(previous, { noteContext, value: textEditor }));
        });
    }, [ noteContext ]);

    // React to editor initializing.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (eventNtxId !== noteContext?.ntxId) return;
        setResolved((previous) => keepIfSame(previous, { noteContext, value: editor }));
    });

    // An editor of another context, such as the previous split, is never returned.
    return resolved.noteContext === noteContext ? resolved.value : null;
}

/** The content element of `noteContext`, or `null` while it is looked up. */
export function useContentElement(noteContext: NoteContext | null | undefined) {
    const [ resolved, setResolved ] = useState<ResolvedValue<HTMLElement | null>>({
        noteContext, value: null
    });
    const requestIdRef = useRef(0);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        noteContext?.getContentElement().then(contentElement => {
            // Prevent stale async.
            if (!contentElement || requestId !== requestIdRef.current) return;
            setResolved({ noteContext, value: contentElement?.[0] ?? null });
        });
    }, [ noteContext ]);

    // React to content changes initializing. A new object re-renders for the same element too.
    useTriliumEvent("contentElRefreshed", ({ ntxId: eventNtxId, contentEl }) => {
        if (eventNtxId !== noteContext?.ntxId) return;
        setResolved({ noteContext, value: contentEl });
    });

    // An element of another context, such as the previous split, is never returned.
    return resolved.noteContext === noteContext ? resolved.value : null;
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
    const [data, setData] = useState<ResolvedValue<NoteContextDataMap[K] | undefined>>(() => ({
        noteContext, value: noteContext?.getContextData(key)
    }));

    // Update initial value when noteContext changes
    useEffect(() => {
        const value = noteContext?.getContextData(key);
        setData((previous) => keepIfSame(previous, { noteContext, value }));
    }, [noteContext, key]);

    // Subscribe to changes via Trilium event system
    useTriliumEvent("contextDataChanged", ({ noteContext: eventNoteContext, key: changedKey, value }) => {
        if (eventNoteContext === noteContext && changedKey === key) {
            const next = { noteContext, value: value as NoteContextDataMap[K] };
            setData((previous) => keepIfSame(previous, next));
        }
    });

    // The state is set by an effect, so the first render with another context reads that context.
    return data.noteContext === noteContext ? data.value : noteContext?.getContextData(key);
}
