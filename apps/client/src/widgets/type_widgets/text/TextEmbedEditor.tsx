import "./TextEmbedEditor.css";

import { createPortal } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { randomString } from "../../../services/utils";
import {
    announceEmbeddedNoteClosing, EmbeddedNoteScope, useEmbeddedNoteContext
} from "../../EmbeddedNotePane";
import { SaveStatusBadge } from "../../layout/NoteBadges";
import { useLegacyComponentElement, useNoteContext } from "../../react/hooks";
import EditableText from "./EditableText";
import { NestedEmbedContext, useEmbedBadgeSlot } from "./editable_embed";

interface TextEmbedEditorProps {
    note: FNote;
    /** Whether the editor around the embed has a fixed toolbar, rather than a floating one. */
    hasFixedToolbar: boolean;
}

/**
 * The text editor of a text note in an embed. It has a note context and a component of its own,
 * as the note pane of a geo map does, and saves the note as a note tab does.
 */
export default function TextEmbedEditor({ note, hasFixedToolbar }: TextEmbedEditorProps) {
    const [ ntxId ] = useState(() => `_embed_${randomString(10)}`);
    // Inside an editor with a fixed toolbar, that toolbar shows the buttons of this editor while
    // it has the focus.
    const { noteContext, component } =
        useEmbeddedNoteContext(note, ntxId, { floatingToolbar: !hasFixedToolbar });

    // A layout cleanup runs while the editor is still mounted, so it saves what is left.
    useLayoutEffect(() => () => {
        void announceEmbeddedNoteClosing(component, ntxId);
    }, [ component, ntxId ]);

    return (
        <EmbeddedNoteScope component={component} noteContext={noteContext}>
            <NestedEmbedContext.Provider value={true}>
                <ScopedEditor note={note} />
            </NestedEmbedContext.Provider>
        </EmbeddedNoteScope>
    );
}

/** The editor, once the note context of the embed holds `note`. */
function ScopedEditor({ note }: { note: FNote }) {
    const rootRef = useRef<HTMLDivElement>(null);
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
