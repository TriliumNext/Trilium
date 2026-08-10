import "./NoteMap.css";

import { useRef } from "preact/hooks";

// The map itself is shared with the ribbon's note map tab and the note map note type;
// only the framing differs here.
import NoteMapEl from "../note_map/NoteMap";
import { useActiveNoteContext } from "../react/hooks";

/**
 * The map of the connections tab, kept in a module of its own so that the card around it (see
 * NoteMap.tsx) can load it on demand: it pulls in force-graph, which is deliberately kept out of the
 * boot bundle.
 */
export default function NoteMapGraph() {
    const { note } = useActiveNoteContext();
    const containerRef = useRef<HTMLDivElement>(null);

    if (!note) {
        return null;
    }

    return (
        <div class="sidebar-note-map" ref={containerRef}>
            {/* "sidebar" mode roots the map at the note being read, which is what a connections panel
                is about (the other modes root it at a configured or hoisted note), and drops the
                notes nothing links to — see loadNotesAndRelations. */}
            <NoteMapEl note={note} widgetMode="sidebar" parentRef={containerRef} />
        </div>
    );
}
