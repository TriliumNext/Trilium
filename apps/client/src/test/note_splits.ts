import { act } from "preact/test-utils";

import appContext from "../components/app_context";
import type NoteContext from "../components/note_context";

/**
 * Shows a split for `noteContext` in the layout rendered into `container`, as the tab manager does
 * once it restores a tab: a stand-in tab manager holds only that context, and the split container
 * hears it was created. Returns a function that puts the tab manager back, for a case to call once
 * nothing it renders asks for the tabs any more.
 */
export async function showNoteSplit(container: HTMLElement | undefined, noteContext: NoteContext) {
    const originalTabManager = appContext.tabManager;
    appContext.tabManager = {
        noteContexts: [ noteContext ],
        getActiveMainContext: () => noteContext,
        getActiveContext: () => noteContext,
        // The split container reads its contexts by ID as the active context changes.
        getNoteContextById: (ntxId: string | null) => (ntxId === noteContext.ntxId ? noteContext : null)
    } as unknown as typeof appContext.tabManager;
    const splits = container?.querySelector<HTMLElement>(".split-note-container-widget");
    if (!splits) throw new Error("The layout has no note splits.");
    await act(async () => {
        await $(splits).prop("component").handleEvent("newNoteContextCreated", { noteContext });
    });
    return () => {
        appContext.tabManager = originalTabManager;
    };
}
