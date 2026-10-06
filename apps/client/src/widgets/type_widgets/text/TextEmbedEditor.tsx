import "./TextEmbedEditor.css";

import { createPortal, type RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { randomString } from "../../../services/utils";
import {
    announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext
} from "../../EmbeddedNotePane";
import { SaveStatusBadge } from "../../layout/NoteBadges";
import { useLegacyComponentElement, useNoteContext } from "../../react/hooks";
import EditableText from "./EditableText";
import { findTextEditorIn, NestedEmbedContext, useEmbedBadgeSlot } from "./editable_embed";
import { getClosingSave, trackClosingSave } from "./TextEmbed";

interface TextEmbedEditorProps {
    note: FNote;
    /** Whether the editor around the embed has a fixed toolbar, rather than a floating one. */
    hasFixedToolbar: boolean;
    /** Receives the content of the editor as it goes away, which can be unsaved yet. */
    onClose(content: string): void;
}

/**
 * The text editor of a text note in an embed. It has a note context and a component of its own,
 * as the note pane of a geo map does, and saves the note as a note tab does.
 */
export default function TextEmbedEditor({ note, hasFixedToolbar, onClose }: TextEmbedEditorProps) {
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
        trackClosingSave(note.noteId, announceEmbeddedNoteClosing(component, ntxId));
        const content = findTextEditorIn(rootRef.current)?.getData();
        if (content !== undefined) {
            onCloseRef.current(content);
        }
    }, [ component, ntxId ]);

    return (
        <EmbeddedNoteScope component={component} noteContext={noteContext}>
            <NestedEmbedContext.Provider value={true}>
                <ScopedEditor rootRef={rootRef} note={note} />
            </NestedEmbedContext.Provider>
        </EmbeddedNoteScope>
    );
}

interface ScopedEditorProps {
    rootRef: RefObject<HTMLDivElement | null>;
    note: FNote;
}

/** The editor, once the note context of the embed holds `note`. */
function ScopedEditor({ rootRef, note }: ScopedEditorProps) {
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
                />
            )}
            {badgeSlot && createPortal(<SaveStatusBadge />, badgeSlot)}
        </div>
    );
}
