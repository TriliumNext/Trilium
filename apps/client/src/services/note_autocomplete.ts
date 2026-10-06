import type { AutocompleteResult, InboxTargetResponse } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import commandRegistry from "./command_registry.js";
import dateNoteService from "./date_notes.js";
import { t } from "./i18n.js";
import noteCreateService from "./note_create.js";
import { notePresetOptions } from "./note_presets.js";
import server from "./server.js";
import { escapeHtml } from "./utils.js";
import { logError } from "./ws.js";

// Short on purpose: a search costs tens of milliseconds, so this exists to merge keystrokes that
// arrive faster than a person reads a result, not to wait out a slow server. Anything longer is
// felt on every keystroke typed at a normal pace.
const SEARCH_DEBOUNCE_MS = 50;

/**
 * One row of the dropdown: a note from `GET /api/autocomplete`, or a row added by the client.
 * A client row sets `action` to its kind and fills in only the fields that kind uses.
 */
export interface Suggestion extends Partial<AutocompleteResult> {
    action?: string | "create-note" | "create-child-note" | "search-notes" | "full-text-search" | "external-link" | "command";
    externalLink?: string;
    parentNoteId?: string;
    commandId?: string;
    commandDescription?: string;
    /** The command's keyboard shortcut as stored, which `renderShortcutKbds()` formats. */
    commandShortcut?: string;
}

export interface Options {
    fastSearch?: boolean;
    allowCreatingNotes?: boolean;
    allowJumpToSearchNotes?: boolean;
    allowExternalLinks?: boolean;
    /** If set, hides the right-side button corresponding to go to selected note. */
    hideGoToSelectedNoteButton?: boolean;
    /** If set, hides all right-side buttons in the autocomplete dropdown */
    hideAllButtons?: boolean;
    /** If set, enables command palette mode */
    isCommandPalette?: boolean;
}

export interface NoteSuggestionOptions {
    /** Adds the two note-creation rows last, after the notes and the search row, for a non-blank term. */
    allowCreatingNotes?: boolean;
    /** Adds a row that runs a search for a non-blank term, after the notes. */
    allowJumpToSearchNotes?: boolean;
    /** Adds a row that inserts a term that is a URL as an external link, ahead of everything. */
    allowExternalLinks?: boolean;
    /** Searches the titles only, as autocompletion does, or the content as well. */
    fastSearch?: boolean;
    /** Lists at most this many notes, which the server then stops at. The action rows come on top. */
    limit?: number;
}

/**
 * Returns the notes matching `term`, or the recently visited notes when `term` is blank, with the
 * action rows the options ask for.
 */
export async function getNoteSuggestions(term: string, { allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks, fastSearch = true, limit }: NoteSuggestionOptions = {}): Promise<Suggestion[]> {
    const activeNoteId = appContext.tabManager.getActiveContextNoteId();
    const hasTerm = term.trim().length >= 1;

    // Runs concurrently with the search, so naming the destination costs a request but no wait.
    const pendingInboxTarget = hasTerm && allowCreatingNotes ? getInboxTarget() : null;

    const results: Suggestion[] = await server.get<AutocompleteResult[]>(`autocomplete?query=${encodeURIComponent(term)}&activeNoteId=${activeNoteId}&fastSearch=${fastSearch}${limit ? `&limit=${limit}` : ""}`);
    const before: Suggestion[] = [];
    const after: Suggestion[] = [];

    if (allowExternalLinks && /^[a-z]+:\/\/.+/i.test(term)) {
        before.push({
            action: "external-link",
            externalLink: term,
            highlightedNotePathTitle: t("note_autocomplete.insert-external-link", { term: escapeHtml(term) })
        });
    }

    if (hasTerm && allowJumpToSearchNotes) {
        after.push({
            action: "search-notes",
            noteTitle: term,
            highlightedNotePathTitle: t("note_autocomplete.show-in-full-search", { term: escapeHtml(term) })
        });
    }

    // Last, so that Up from the first note reaches them first; the search rows have keys of their own.
    if (pendingInboxTarget) {
        after.push({
            action: "create-note",
            noteTitle: term,
            highlightedNotePathTitle: buildCreateNoteTitle(term, await pendingInboxTarget)
        }, {
            action: "create-child-note",
            noteTitle: term,
            parentNoteId: activeNoteId || "root",
            highlightedNotePathTitle: t("note_autocomplete.create-child-note", { term: escapeHtml(term) })
        });
    }

    return [ ...before, ...results, ...after ];
}

/**
 * Creates the note a creation row offers, under the parent the user picks in the type chooser, or
 * else in the inbox (`create-note`) or under `childParentNotePath` or the row's parent
 * (`create-child-note`). Returns the new note's path, or nothing when the chooser is canceled or no
 * parent is found.
 *
 * @param childParentNotePath the note a host is editing, which the row's parent, the active note,
 * need not be.
 */
export async function createNoteFromSuggestion(suggestion: Suggestion, childParentNotePath?: string | null) {
    const {
        success, noteType, mime, templateNoteId, notePreset, notePath, cloneToNoteIds
    } = await noteCreateService.chooseNoteType();
    if (!success) {
        return;
    }

    const parentNotePath = notePath ?? (suggestion.action === "create-note"
        ? await dateNoteService.getInboxNotePath()
        : childParentNotePath ?? suggestion.parentNoteId);
    if (!parentNotePath) {
        return;
    }

    const { note } = await noteCreateService.createNote(parentNotePath, {
        title: suggestion.noteTitle,
        activate: false,
        type: noteType,
        mime,
        templateNoteId,
        ...notePresetOptions(notePreset),
        cloneToNoteIds
    });

    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    return note?.getBestNotePathString(hoistedNoteId);
}

/** When a recent note was last visited, as the lists group the recent notes under headings. */
export type RecentNoteGroup = "today" | "yesterday" | "past-week" | "past-month" | "older";

/**
 * The group of a note visited at `utcDateVisited` (`YYYY-MM-DD HH:mm:ss.SSSZ`), counted in local
 * days back from `now`: today, yesterday, the 7 days that end today, the 30 days, and before them.
 */
export function recentNoteGroup(utcDateVisited: string, now: Date): RecentNoteGroup {
    const visited = new Date(utcDateVisited.replace(" ", "T"));
    const daysBack = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);

    if (visited >= daysBack(0)) return "today";
    if (visited >= daysBack(1)) return "yesterday";
    if (visited >= daysBack(6)) return "past-week";
    if (visited >= daysBack(29)) return "past-month";
    return "older";
}

/**
 * Returns the commands matching what follows the `>` that opens `term`, or every command when
 * nothing follows it.
 */
export function getCommandSuggestions(term: string): Suggestion[] {
    const query = term.substring(1).trim();
    const commands = query ? commandRegistry.searchCommands(query) : commandRegistry.getAllCommands();

    return commands.map((command) => ({
        action: "command",
        commandId: command.id,
        noteTitle: command.name,
        notePathTitle: `>${command.name}`,
        highlightedNotePathTitle: command.name,
        commandDescription: command.description,
        commandShortcut: command.shortcut,
        icon: command.icon
    }));
}

/**
 * Paces one input's searches: the first keystroke after a pause queries immediately, a burst typed
 * faster than {@link SEARCH_DEBOUNCE_MS} collapses into one search that runs once it stops, and at
 * most one search is ever outstanding.
 *
 * The single-flight part is what keeps a slow search from compounding. The server answers
 * autocomplete requests one at a time, so firing a second while the first is still running makes
 * every later keystroke wait out the whole queue ahead of it. Holding the newest term back until
 * the outstanding search settles paces requests at whatever the server can actually serve, without
 * the client having to know how slow that is.
 *
 * Each input creates its own, so a keystroke in one cannot cancel or delay what another is waiting
 * on.
 */
export function createSearchScheduler() {
    type Search = () => void | Promise<void>;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let lastCallAt = 0;
    let running = false;
    let queued: Search | undefined;

    function start(runSearch: Search) {
        // Only the newest term is worth searching for, so a search waiting here replaces the one
        // before it instead of queueing behind it.
        if (running) {
            queued = runSearch;
            return;
        }

        running = true;
        void Promise.resolve(runSearch())
            .catch((e) => logError(`Autocomplete search failed: ${e}`))
            .finally(() => {
                running = false;
                const next = queued;
                queued = undefined;
                if (next) {
                    start(next);
                }
            });
    }

    return (runSearch: Search) => {
        // A newer keystroke supersedes whatever the previous one left waiting, be that a pending
        // timer or a search held back by the one in flight.
        clearTimeout(timeoutId);
        queued = undefined;

        // Measured from the previous keystroke rather than the previous search. Measuring from the
        // search paces requests at a fixed rate instead of ending the window when typing pauses.
        const now = Date.now();
        const startsBurst = now - lastCallAt >= SEARCH_DEBOUNCE_MS;
        lastCallAt = now;

        if (startsBurst) {
            start(runSearch);
        } else {
            timeoutId = setTimeout(() => start(runSearch), SEARCH_DEBOUNCE_MS);
        }
    };
}

async function getInboxTarget() {
    try {
        return await dateNoteService.getInboxTarget();
    } catch (e) {
        // The entry falls back to a label with no destination rather than failing the dropdown.
        logError(`Unable to resolve the inbox target: ${e}`);
        return null;
    }
}

/** Labels the creation entry with the note the capture would land in. */
function buildCreateNoteTitle(term: string, target: InboxTargetResponse | null) {
    if (!target) {
        return t("note_autocomplete.create-note", { term: escapeHtml(term) });
    }

    if (target.kind === "dayNote") {
        return t("note_autocomplete.create-note-into-day-note", { term: escapeHtml(term) });
    }

    // The root note's own title is not one the user recognizes in the tree.
    if (target.kind === "root") {
        return t("note_autocomplete.create-note-into-root", { term: escapeHtml(term) });
    }

    if (!target.title) {
        return t("note_autocomplete.create-note", { term: escapeHtml(term) });
    }

    return t("note_autocomplete.create-note-into", { term: escapeHtml(term), parentTitle: escapeHtml(target.title) });
}
