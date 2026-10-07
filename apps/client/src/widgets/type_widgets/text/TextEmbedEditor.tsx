import "./TextEmbedEditor.css";

import { createPortal, type RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FNote from "../../../entities/fnote";
import { randomString } from "../../../services/utils";
import {
    announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext
} from "../../EmbeddedNotePane";
import { SaveStatusBadge } from "../../layout/NoteBadges";
import { useLegacyComponentElement, useNoteContext } from "../../react/hooks";
import EditableText, { getBlockData } from "./EditableText";
import { findTextEditorIn, NestedEmbedContext, useEmbedBadgeSlot } from "./editable_embed";
import { getClosingSave, trackClosingSave } from "./TextEmbed";

interface TextEmbedEditorProps {
    note: FNote;
    /** The blocks of the note to edit, a `block` link parameter. The whole note when left out. */
    block?: string;
    /** Receives the blocks that the editor of `block` holds, each time they change. */
    onBlockChange?: (block: string) => void;
    /** Whether the editor around the embed has a fixed toolbar, rather than a floating one. */
    hasFixedToolbar: boolean;
    /**
     * Receives the content of the editor as it goes away, which can be unsaved yet, and the save
     * of what is left.
     */
    onClose(content: string, save: Promise<boolean>): void;
}

/**
 * The text editor of a text note in an embed. It has a note context and a component of its own,
 * as the note pane of a geo map does, and saves the note as a note tab does.
 */
export default function TextEmbedEditor({
    note, block, onBlockChange, hasFixedToolbar, onClose
}: TextEmbedEditorProps) {
    // The embed shows its preview until the editor that it replaces has saved the note.
    const closingSave = getClosingSave(note.noteId);
    if (closingSave) throw closingSave;

    const [ ntxId ] = useState(() => `_embed_${randomString(10)}`);
    const rootRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    // Inside an editor with a fixed toolbar, that toolbar shows the buttons of this editor while
    // it has the focus.
    const { noteContext, component } = useEmbeddedNoteContext(note, ntxId, {
        floatingToolbar: !hasFixedToolbar,
        skipRecentNotes: true
    });

    // A layout cleanup runs while the editor is still mounted, so it saves what is left.
    useLayoutEffect(() => () => {
        const save = trackClosingSave(note.noteId, saveWhatIsLeft(component, noteContext, ntxId));
        const editor = findTextEditorIn(rootRef.current);
        if (!editor) return;

        const content = block === undefined
            ? editor.getData()
            : getBlockData(editor, block).content;
        onCloseRef.current(content, save);
    }, [ component, noteContext, ntxId ]);

    return (
        <EmbeddedNoteScope component={component} noteContext={noteContext}>
            <NestedEmbedContext.Provider value={true}>
                <ScopedEditor
                    rootRef={rootRef}
                    note={note}
                    block={block}
                    onBlockChange={onBlockChange}
                />
            </NestedEmbedContext.Provider>
        </EmbeddedNoteScope>
    );
}

interface ScopedEditorProps {
    rootRef: RefObject<HTMLDivElement | null>;
    note: FNote;
    block: string | undefined;
    onBlockChange: ((block: string) => void) | undefined;
}

/** The editor, once the note context of the embed holds `note`. */
function ScopedEditor({ rootRef, note, block, onBlockChange }: ScopedEditorProps) {
    const { note: contextNote, noteContext, ntxId, parentComponent } = useNoteContext();
    // The plugins of the editor find their host by the element of its component.
    useLegacyComponentElement(rootRef);
    const badgeSlot = useEmbedBadgeSlot(rootRef);

    return (
        <div ref={rootRef} className="text-embed-editor">
            {noteContext && contextNote?.noteId === note.noteId && (
                <EditableText
                    note={note}
                    noteContext={noteContext}
                    ntxId={ntxId ?? null}
                    parentComponent={parentComponent}
                    viewScope={noteContext.viewScope}
                    block={block}
                    onBlockChange={onBlockChange}
                />
            )}
            {badgeSlot && createPortal(<SaveStatusBadge />, badgeSlot)}
        </div>
    );
}

/**
 * Saves what is left in the editor of `ntxId`, and resolves to whether the save succeeded. The
 * editor reports a failed save in the save state of its note context.
 */
async function saveWhatIsLeft(component: Component, noteContext: NoteContext, ntxId: string) {
    await announceEmbeddedNoteClosing(component, ntxId);
    return noteContext.getContextData("saveState")?.state !== "error";
}
