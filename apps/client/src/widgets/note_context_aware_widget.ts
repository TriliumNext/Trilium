import BasicWidget from "./basic_widget.js";
import appContext, { type EventData } from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import type NoteContext from "../components/note_context.js";

/**
 * This widget allows for changing and updating depending on the active note.
 */
class NoteContextAwareWidget extends BasicWidget {
    noteContext?: NoteContext;

    isNoteContext(ntxId: string | string[] | null | undefined) {
        if (Array.isArray(ntxId)) {
            return this.noteContext && this.noteContext.ntxId && ntxId.includes(this.noteContext.ntxId);
        } else {
            return this.noteContext && this.noteContext.ntxId === ntxId;
        }
    }

    isActiveNoteContext() {
        return appContext.tabManager.getActiveContext() === this.noteContext;
    }

    isNote(noteId: string) {
        return this.noteId === noteId;
    }

    get note() {
        return this.noteContext?.note;
    }

    get noteId() {
        return this.note?.noteId;
    }

    get notePath() {
        return this.noteContext?.notePath;
    }

    get hoistedNoteId() {
        return this.noteContext?.hoistedNoteId;
    }

    get ntxId() {
        return this.noteContext?.ntxId;
    }

    /**
     * Indicates if the widget is enabled. Widgets are enabled by default. Generally setting this to `false` will cause the widget not to be displayed, however it will still be available on the DOM but hidden.
     *
     * <p>
     * If the widget is not enabled, it will not receive `refreshWithNote` updates.
     *
     * @returns true when an active note exists
     */
    isEnabled(): boolean | null | undefined {
        return !!this.note;
    }

    async refresh() {
        if (this.isEnabled()) {
            this.toggleInt(true);

            try {
                await this.refreshWithNote(this.note);
            } catch (e) {
                // Ignore errors when user is refreshing or navigating away.
                if (e === "rejected by browser") {
                    return;
                }

                throw e;
            }
        } else {
            this.toggleInt(false);
        }
    }

    async refreshWithNote(note: FNote | null | undefined) {}

    async noteSwitchedEvent({ noteContext, notePath }: EventData<"noteSwitched">) {
        // if notePath does not match, then the noteContext has been switched to another note in the meantime
        if (noteContext.notePath === notePath) {
            await this.noteSwitched();
        }
    }

    async noteSwitched() {
        await this.refresh();
    }

    async activeContextChangedEvent({ noteContext }: EventData<"activeContextChanged">) {
        this.noteContext = noteContext;

        await this.activeContextChanged();
    }

    async activeContextChanged() {
        await this.refresh();
    }

    // when note is both switched and activated, this should not produce a double refresh
    async noteSwitchedAndActivatedEvent({ noteContext, notePath }: EventData<"noteSwitchedAndActivated">) {
        this.noteContext = noteContext;

        // if notePath does not match, then the noteContext has been switched to another note in the meantime
        if (this.notePath === notePath) {
            await this.refresh();
        }
    }

    setNoteContextEvent({ noteContext }: EventData<"setNoteContext">) {
        /** @var {NoteContext} */
        this.noteContext = noteContext;
    }

    async noteTypeMimeChangedEvent({ noteId }: EventData<"noteTypeMimeChanged">) {
        if (this.isNote(noteId)) {
            await this.refresh();
        }
    }

    async frocaReloadedEvent(): Promise<void> {
        await this.refresh();
    }
}

export default NoteContextAwareWidget;
