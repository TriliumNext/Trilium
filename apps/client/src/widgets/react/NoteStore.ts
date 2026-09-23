type Listener = () => void;

class NoteSavedDataStore {
    private data = new Map<string, string>();
    private listeners = new Map<string, Set<Listener>>();

    get(noteId: string) {
        return this.data.get(noteId);
    }

    set(noteId: string, value: string) {
        this.data.set(noteId, value);
        this.listeners.get(noteId)?.forEach(l => l());
    }

    subscribe(noteId: string, listener: Listener) {
        let set = this.listeners.get(noteId);
        if (!set) {
            set = new Set();
            this.listeners.set(noteId, set);
        }
        set.add(listener);

        return () => {
            set!.delete(listener);
            if (set!.size === 0) {
                this.listeners.delete(noteId);
            }
        };
    }
}

export const noteSavedDataStore = new NoteSavedDataStore();

/**
 * The note whose content each live text editor holds. A CKEditor instance is reused across note
 * switches and across the read-only ↔ editable switch, so a consumer that reads its model (the
 * sidebar table of contents) has to tell whether what is in it belongs to the note it shows.
 */
const editorNoteIds = new WeakMap<object, string>();

export function setEditorNoteId(editor: object, noteId: string) {
    editorNoteIds.set(editor, noteId);
}

export function getEditorNoteId(editor: object) {
    return editorNoteIds.get(editor);
}
