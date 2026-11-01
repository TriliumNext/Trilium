import { EmbeddedNoteList } from "@triliumnext/client/src/widgets/collections/NoteList.js";
import { render } from "preact";

import ShareAppHost, { type AppPayload } from "./app_host.js";

/**
 * Mounts the app's note list over the collection, which picks the collection's view from its
 * `#viewType` and opens the notes the view selects on their shared pages.
 */
export default function mountCollection(container: HTMLElement, payload: AppPayload) {
    render(
        <ShareAppHost noteId={container.dataset.noteId ?? ""} payload={payload}>
            {({ note, openNote }) => (
                <EmbeddedNoteList
                    note={note}
                    notePath={note.noteId}
                    ntxId={null}
                    media="screen"
                    onOpenNote={openNote}
                />
            )}
        </ShareAppHost>,
        container
    );
}
