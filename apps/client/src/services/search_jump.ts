import appContext from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";

/**
 * One-shot consumer of `viewScope.searchTerms`: when a note is opened from search results the terms
 * ride along in the view scope (see `link.ts`); this reads them, clears them, and fires a seeded
 * `findInText` so the find bar opens on the first match. Mirrors how `viewScope.bookmark` is
 * consumed by the type widgets.
 *
 * The terms are cleared synchronously (before the deferred trigger) so the belt-and-suspenders
 * double invocation — the content-ready effect plus the same-note re-click `noteSwitched` listener —
 * only opens the bar once.
 *
 * The trigger itself is deferred to the next animation frame so it runs *after* the `noteSwitched`
 * dispatch that led here has fully drained. FindWidget also handles `noteSwitched` (by calling
 * `closeSearch`); without the defer, a synchronous trigger from within the same dispatch could open
 * the bar only for FindWidget's own `noteSwitched -> closeSearch` to immediately close it again.
 */
export function consumeSearchTerms(noteContext: NoteContext | undefined | null, ntxId: string | null | undefined): void {
    const viewScope = noteContext?.viewScope;
    const searchTerms = viewScope?.searchTerms;
    if (!viewScope || !searchTerms?.length) {
        return;
    }

    viewScope.searchTerms = undefined;
    requestAnimationFrame(() => appContext.triggerCommand("findInText", { ntxId, searchTerms }));
}
