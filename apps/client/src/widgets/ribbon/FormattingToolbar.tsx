import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import { useActiveNoteContext, useNoteProperty, useTriliumEvent, useTriliumEvents, useTriliumOption } from "../react/hooks";
import { TabContext } from "./ribbon-interface";

/**
 * Handles the editing toolbar when the CKEditor is in decoupled mode.
 *
 * This toolbar is only enabled if the user has selected the classic CKEditor.
 *
 * The ribbon item is active by default for text notes, as long as they are not in read-only mode.
 *
 * ! The toolbar is not only used in the ribbon, but also in the quick edit feature.
 * * The mobile toolbar is handled separately (see `MobileEditorToolbar`).
 */
export default function FormattingToolbar({ hidden, ntxId }: TabContext) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");

    // Attach the toolbar from the CKEditor.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (eventNtxId !== ntxId || !containerRef.current) return;
        const toolbar = editor.ui.view.toolbar?.element;

        if (toolbar) {
            containerRef.current.replaceChildren(toolbar);
        } else {
            containerRef.current.replaceChildren();
        }
    });

    return (textNoteEditorType === "ckeditor-classic" &&
        <div
            ref={containerRef}
            className={`classic-toolbar-widget ${hidden ? "hidden-ext" : ""}`}
        />
    );
};

const toolbarCache = new Map<string, HTMLElement | null | undefined>();

export function FixedFormattingToolbar() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { note, noteContext, ntxId } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const renderState = useRenderState(noteContext, note);
    const [ toolbarToRender, setToolbarToRender ] = useState<HTMLElement | null | undefined>();

    // Keyboard shortcut.
    const lastFocusedElement = useRef<Element>(null);
    useTriliumEvent("toggleRibbonTabClassicEditor", () => {
        if (!toolbarToRender) return;
        if (!toolbarToRender.contains(document.activeElement)) {
            // Focus to the fixed formatting toolbar.
            lastFocusedElement.current = document.activeElement;
            toolbarToRender.querySelector<HTMLButtonElement>(".ck-toolbar__items button")?.focus();
        } else {
            // Focus back to the last selection.
            (lastFocusedElement.current as HTMLElement)?.focus();
            lastFocusedElement.current = null;
        }
    });

    // Populate the cache with the toolbar of every note context.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (!eventNtxId) return;
        const toolbar = editor.ui.view.toolbar?.element;
        toolbarCache.set(eventNtxId, toolbar);
        // Replace on the spot if the editor crashed.
        if (eventNtxId === ntxId) {
            setToolbarToRender(toolbar);
        }
    });

    // Clean the cache when tabs are closed.
    useTriliumEvent("noteContextRemoved", ({ ntxIds: eventNtxIds }) => {
        for (const eventNtxId of eventNtxIds) {
            toolbarCache.delete(eventNtxId);
        }
    });

    // Switch between the cached toolbar when user navigates to a different note context.
    useEffect(() => {
        if (!ntxId) return;
        const toolbar = toolbarCache.get(ntxId);
        if (toolbar) {
            setToolbarToRender(toolbar);
        }
    }, [ ntxId, noteType, noteContext ]);

    // Render the toolbar.
    useEffect(() => {
        if (toolbarToRender) {
            containerRef.current?.replaceChildren(toolbarToRender);
        } else {
            containerRef.current?.replaceChildren();
        }
    }, [ toolbarToRender ]);

    return (
        <div
            ref={containerRef}
            className={clsx("classic-toolbar-widget", {
                "hidden-ext": renderState === "hidden",
                "disabled": renderState === "disabled"
            })}
        />
    );
}

function useRenderState(activeNoteContext: NoteContext | undefined, activeNote: FNote | null | undefined) {
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");
    const [ state, setState ] = useState("hidden");

    useTriliumEvents([ "newNoteContextCreated", "noteContextRemoved", "readOnlyTemporarilyDisabled" ], () => {
        getFormattingToolbarState(activeNoteContext, activeNote, textNoteEditorType).then(setState);
    });

    useEffect(() => {
        getFormattingToolbarState(activeNoteContext, activeNote, textNoteEditorType).then(setState);
    }, [ activeNoteContext, activeNote, textNoteEditorType ]);

    return state;
}

export async function getFormattingToolbarState(activeNoteContext: NoteContext | undefined, activeNote: FNote | null | undefined, textNoteEditorType: string) {
    if (!activeNoteContext || textNoteEditorType !== "ckeditor-classic") {
        return "hidden";
    }

    const subContexts = activeNoteContext?.getMainContext().getSubContexts() ?? [];
    if (subContexts.length === 1) {
        if (activeNote?.type !== "text" || activeNoteContext.viewScope?.viewMode !== "default") {
            return "hidden";
        }

        const isReadOnly = await activeNoteContext.isReadOnly();
        if (isReadOnly) {
            return "hidden";
        }

        return "visible";
    }

    // If there are multiple note contexts (e.g. splits), the logic is slightly different.
    const textNoteContexts = subContexts.filter(s => s.note?.type === "text" && s.viewScope?.viewMode === "default");
    const textNoteContextsReadOnly = await Promise.all(textNoteContexts.map(sc => sc.isReadOnly()));

    // If all text notes are hidden, no need to display the toolbar at all.
    if (textNoteContextsReadOnly.indexOf(false) === -1) {
        return "hidden";
    }

    // If the current subcontext is not a text note, but there is at least an editable text then it must be disabled.
    if (activeNote?.type !== "text") return "disabled";

    // If the current subcontext is a text note, it must not be read-only.
    const subContextIndex = textNoteContexts.indexOf(activeNoteContext);
    if (subContextIndex !== -1) {
        if (textNoteContextsReadOnly[subContextIndex]) return "disabled";
    }
    if (activeNoteContext.viewScope?.viewMode !== "default") return "disabled";
    return "visible";
}
