import appContext from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";

/**
 * Reads `viewScope.searchTerms`, which `link.ts` sets when a note is opened from search results,
 * clears them, and fires a seeded `findInText` so the find bar opens on the first match. Mirrors
 * how the type widgets consume `viewScope.bookmark`.
 *
 * Clearing is synchronous so that the two call paths, the content-ready one and the same-note
 * re-click one, open the bar only once. The trigger waits a frame so it runs after the
 * `noteSwitched` dispatch drains, because FindWidget calls `closeSearch` on that same event.
 */
export function consumeSearchTerms(noteContext: NoteContext | undefined | null, ntxId: string | null | undefined): void {
    const viewScope = noteContext?.viewScope;
    const searchTerms = viewScope?.searchTerms;
    if (!viewScope || !searchTerms?.length) {
        return;
    }

    viewScope.searchTerms = undefined;
    requestAnimationFrame(() => {
        // Navigation replaces the viewScope object, so a different identity here means the tab
        // moved on and this find would target the wrong note. The new navigation carries its own
        // searchTerms, so aborting loses nothing.
        if (noteContext.viewScope !== viewScope) {
            return;
        }
        appContext.triggerCommand("findInText", { ntxId, searchTerms });
    });
}
