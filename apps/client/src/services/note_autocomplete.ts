import server from "./server.js";
import appContext from "../components/app_context.js";
import noteCreateService from "./note_create.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import commandRegistry from "./command_registry.js";
import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";
import { CreateNoteAction } from "@triliumnext/commons"
import FNote from "../entities/fnote.js";

/**
 * Extends CKEditor's MentionFeedObjectItem with extra fields used by Trilium.
 * These additional props (like action, notePath, name, etc.) carry note
 * metadata and legacy compatibility info needed for custom autocomplete
 * and link insertion behavior beyond CKEditor’s base mention support.
 */
type ExtendedMentionFeedObjectItem = MentionFeedObjectItem & {
    action?: string;
    noteTitle?: string;
    name?: string;
    link?: string;
    notePath?: string;
    parentNoteId?: string;
    highlightedNotePathTitle?: string;
};

// this key needs to have this value, so it's hit by the tooltip
const SELECTED_NOTE_PATH_KEY = "data-note-path";

const SELECTED_EXTERNAL_LINK_KEY = "data-external-link";

// To prevent search lag when there are a large number of notes, set a delay based on the number of notes to avoid jitter.
const notesCount = await server.get<number>(`autocomplete/notesCount`);
let debounceTimeoutId: ReturnType<typeof setTimeout>;

function getSearchDelay(notesCount: number): number {
    const maxNotes = 20000;
    const maxDelay = 1000;
    const delay = Math.min(maxDelay, (notesCount / maxNotes) * maxDelay);
    return delay;
}
let searchDelay = getSearchDelay(notesCount);

// String values ensure stable, human-readable identifiers across serialization (JSON, CKEditor, logs).
export enum SuggestionAction {
    // These values intentionally mirror CreateNoteAction string values 1:1.
    // This overlap ensures that when a suggestion triggers a note creation callback,
    // the receiving features (e.g. note creation handlers, CKEditor mentions) can interpret
    // the action type consistently
    CreateNote = CreateNoteAction.CreateNote,
    CreateChildNote = CreateNoteAction.CreateChildNote,
    CreateAndLinkNote = CreateNoteAction.CreateAndLinkNote,
    CreateAndLinkChildNote = CreateNoteAction.CreateAndLinkChildNote,

    SearchNotes = "search-notes",
    ExternalLink = "external-link",
    Command = "command",
}

export enum CreateMode {
    None = "none",
    CreateOnly = "create-only",
    CreateAndLink = "create-and-link"
}

// NOTE: Previously marked for deduplication with a server-side type,
// but review on 2025-10-12 (using `rg Suggestion`) found no corresponding
// server implementation.
// This interface appears to be client-only.
export interface Suggestion {
    noteTitle?: string;
    externalLink?: string;
    notePathTitle?: string;
    notePath?: string;
    highlightedNotePathTitle?: string;
    action?: SuggestionAction;
    parentNoteId?: string;
    icon?: string;
    commandId?: string;
    commandDescription?: string;
    commandShortcut?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;
}

export interface Options {
    container?: HTMLElement | null;
    fastSearch?: boolean;
    createMode?: CreateMode;
    allowJumpToSearchNotes?: boolean;
    allowExternalLinks?: boolean;
    /** If set, hides the right-side button corresponding to go to selected note. */
    hideGoToSelectedNoteButton?: boolean;
    /** If set, hides all right-side buttons in the autocomplete dropdown */
    hideAllButtons?: boolean;
    /** If set, enables command palette mode */
    isCommandPalette?: boolean;
}

async function autocompleteSourceForCKEditor(
    queryText: string,
    createMode: CreateMode
): Promise<MentionFeedObjectItem[]> {
    // Wrap the callback-based autocompleteSource in a Promise for async/await
    const rows = await new Promise<Suggestion[]>((resolve) => {
        autocompleteSource(
            queryText,
            (suggestions) => resolve(suggestions),
            {
                createMode,
            }
        );
    });

    // Map internal suggestions to CKEditor mention feed items
    return rows.map((row): ExtendedMentionFeedObjectItem => ({
        action: row.action?.toString(),
        noteTitle: row.noteTitle,
        id: `@${row.notePathTitle}`,
        name: row.notePathTitle || "",
        link: `#${row.notePath}`,
        notePath: row.notePath,
        parentNoteId: row.parentNoteId,
        highlightedNotePathTitle: row.highlightedNotePathTitle
    }));
}

async function autocompleteSource(
    term: string,
    callback: (rows: Suggestion[]) => void,
    options: Options = {}
) {
    // Check if we're in command mode
    if (options.isCommandPalette && term.startsWith(">")) {
        const commandQuery = term.substring(1).trim();

        // Get commands (all if no query, filtered if query provided)
        const commands =
            commandQuery.length === 0
                ? commandRegistry.getAllCommands()
                : commandRegistry.searchCommands(commandQuery);

        // Convert commands to suggestions
        const commandSuggestions: Suggestion[] = commands.map((cmd) => ({
            action: SuggestionAction.Command,
            commandId: cmd.id,
            noteTitle: cmd.name,
            notePathTitle: `>${cmd.name}`,
            highlightedNotePathTitle: cmd.name,
            commandDescription: cmd.description,
            commandShortcut: cmd.shortcut,
            icon: cmd.icon,
        }));

        callback(commandSuggestions);
        return;
    }

    const fastSearch = options.fastSearch !== false;
    const trimmedTerm = term.trim();
    const activeNoteId = appContext.tabManager.getActiveContextNoteId();

    if (!fastSearch && trimmedTerm.length === 0) return;

    if (!fastSearch) {
        callback([
            {
                noteTitle: trimmedTerm,
                highlightedNotePathTitle: t("quick-search.searching"),
            },
        ]);
    }

    let results = await server.get<Suggestion[]>(
        `autocomplete?query=${encodeURIComponent(trimmedTerm)}&activeNoteId=${activeNoteId}&fastSearch=${fastSearch}`
    );

    options.fastSearch = true;

    // --- Create Note suggestions ---
    if (trimmedTerm.length >= 1) {
        switch (options.createMode) {
            case CreateMode.CreateOnly: {
                results = [
                    {
                        action: SuggestionAction.CreateNote,
                        noteTitle: trimmedTerm,
                        parentNoteId: "inbox",
                        highlightedNotePathTitle: t("note_autocomplete.create-note", { term: trimmedTerm }),
                    },
                    {
                        action: SuggestionAction.CreateChildNote,
                        noteTitle: trimmedTerm,
                        parentNoteId: activeNoteId || "root",
                        highlightedNotePathTitle: t("note_autocomplete.create-child-note", { term: trimmedTerm }),
                    },
                    ...results,
                ];
                break;
            }

            case CreateMode.CreateAndLink: {
                results = [
                    {
                        action: SuggestionAction.CreateAndLinkNote,
                        noteTitle: trimmedTerm,
                        parentNoteId: "inbox",
                        highlightedNotePathTitle: t("note_autocomplete.create-and-link-note", { term: trimmedTerm }),
                    },
                    {
                        action: SuggestionAction.CreateAndLinkChildNote,
                        noteTitle: trimmedTerm,
                        parentNoteId: activeNoteId || "root",
                        highlightedNotePathTitle: t("note_autocomplete.create-and-link-child-note", { term: trimmedTerm }),
                    },
                    ...results,
                ];
                break;
            }

            default:
                // CreateMode.None or undefined → no creation suggestions
                break;
        }
    }

    // --- Jump to Search Notes ---
    if (trimmedTerm.length >= 1 && options.allowJumpToSearchNotes) {
        results = [
            ...results,
            {
                action: SuggestionAction.SearchNotes,
                noteTitle: trimmedTerm,
                highlightedNotePathTitle: `${t("note_autocomplete.search-for", {
                    term: trimmedTerm,
                })} <kbd style='color: var(--muted-text-color); background-color: transparent; float: right;'>Ctrl+Enter</kbd>`,
            },
        ];
    }

    // --- External Link suggestion ---
    if (/^[a-z]+:\/\/.+/i.test(trimmedTerm) && options.allowExternalLinks) {
        results = [
            {
                action: SuggestionAction.ExternalLink,
                externalLink: trimmedTerm,
                highlightedNotePathTitle: t("note_autocomplete.insert-external-link", { term: trimmedTerm }),
            },
            ...results,
        ];
    }

    callback(results);
}

function clearText($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    $el.setSelectedNotePath("");
    $el.autocomplete("val", "").trigger("change");
}

function setText($el: JQuery<HTMLElement>, text: string) {
    $el.setSelectedNotePath("");
    $el.autocomplete("val", text.trim()).autocomplete("open");
}

function showRecentNotes($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    $el.setSelectedNotePath("");
    $el.autocomplete("val", "");
    $el.autocomplete("open");
    $el.trigger("focus");
}

function showAllCommands($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    $el.setSelectedNotePath("");
    $el.autocomplete("val", ">").autocomplete("open");
}

function fullTextSearch($el: JQuery<HTMLElement>, options: Options) {
    const searchString = $el.autocomplete("val") as unknown as string;
    if (options.fastSearch === false || searchString?.trim().length === 0) {
        return;
    }
    $el.trigger("focus");
    options.fastSearch = false;
    $el.autocomplete("val", "");
    $el.setSelectedNotePath("");
    searchDelay = 0;
    $el.autocomplete("val", searchString);
}

function renderCommandSuggestion(s: Suggestion): string {
    const icon = s.icon || "bx bx-terminal";
    const shortcut = s.commandShortcut
        ? `<kbd class="command-shortcut">${s.commandShortcut}</kbd>`
        : "";

    return `
        <div class="command-suggestion">
            <span class="command-icon ${icon}"></span>
            <div class="command-content">
                <div class="command-name">${s.highlightedNotePathTitle}</div>
                ${s.commandDescription ? `<div class="command-description">${s.commandDescription}</div>` : ""}
            </div>
            ${shortcut}
        </div>
    `;
}

function renderNoteSuggestion(s: Suggestion): string {
    const actionClass =
        s.action === SuggestionAction.SearchNotes ? "search-notes-action" : "";

    const iconClass = (() => {
        switch (s.action) {
            case SuggestionAction.SearchNotes:
                return "bx bx-search";
            case SuggestionAction.CreateAndLinkNote:
            case SuggestionAction.CreateNote:
                return "bx bx-plus";
            case SuggestionAction.CreateAndLinkChildNote:
            case SuggestionAction.CreateChildNote:
                return "bx bx-plus";
            case SuggestionAction.ExternalLink:
                return "bx bx-link-external";
            default:
                return s.icon ?? "bx bx-note";
        }
    })();

    return `
        <div class="note-suggestion ${actionClass}" style="display:inline-flex; align-items:center;">
            <span class="icon ${iconClass}" style="display:inline-block; vertical-align:middle; line-height:1; margin-right:0.4em;"></span>
            <span class="text" style="display:inline-block; vertical-align:middle;">
                <span class="search-result-title">${s.highlightedNotePathTitle}</span>
                ${s.highlightedAttributeSnippet
                    ? `<span class="search-result-attributes">${s.highlightedAttributeSnippet}</span>`
                    : ""}
            </span>
        </div>
    `;
}

function renderSuggestion(suggestion: Suggestion): string {
    return suggestion.action === SuggestionAction.Command
        ? renderCommandSuggestion(suggestion)
        : renderNoteSuggestion(suggestion);
}

function initNoteAutocomplete($el: JQuery<HTMLElement>, options?: Options) {
    if ($el.hasClass("note-autocomplete-input")) {
        // clear any event listener added in previous invocation of this function
        $el.off("autocomplete:noteselected");

        return $el;
    }

    options = options || {};

    // Used to track whether the user is performing character composition with an input method (such as Chinese Pinyin, Japanese, Korean, etc.) and to avoid triggering a search during the composition process.
    let isComposingInput = false;
    $el.on("compositionstart", () => {
        isComposingInput = true;
    });
    $el.on("compositionend", () => {
        isComposingInput = false;
        const searchString = $el.autocomplete("val") as unknown as string;
        $el.autocomplete("val", "");
        $el.autocomplete("val", searchString);
    });

    $el.addClass("note-autocomplete-input");

    const $clearTextButton = $("<a>").addClass("input-group-text input-clearer-button bx bxs-tag-x").prop("title", t("note_autocomplete.clear-text-field"));

    const $showRecentNotesButton = $("<a>").addClass("input-group-text show-recent-notes-button bx bx-time").prop("title", t("note_autocomplete.show-recent-notes"));

    const $fullTextSearchButton = $("<a>")
        .addClass("input-group-text full-text-search-button bx bx-search")
        .prop("title", `${t("note_autocomplete.full-text-search")} (Shift+Enter)`);

    const $goToSelectedNoteButton = $("<a>").addClass("input-group-text go-to-selected-note-button bx bx-arrow-to-right");

    if (!options.hideAllButtons) {
        $el.after($clearTextButton).after($showRecentNotesButton).after($fullTextSearchButton);
    }

    if (!options.hideGoToSelectedNoteButton && !options.hideAllButtons) {
        $el.after($goToSelectedNoteButton);
    }

    $clearTextButton.on("click", () => clearText($el));

    $showRecentNotesButton.on("click", (e) => {
        showRecentNotes($el);

        // this will cause the click not give focus to the "show recent notes" button
        // this is important because otherwise input will lose focus immediately and not show the results
        return false;
    });

    $fullTextSearchButton.on("click", (e) => {
        fullTextSearch($el, options);
        return false;
    });

    let autocompleteOptions: AutoCompleteConfig = {};
    if (options.container) {
        autocompleteOptions.dropdownMenuContainer = options.container;
        autocompleteOptions.debug = true; // don't close on blur
    }

    if (options.allowJumpToSearchNotes) {
        $el.on("keydown", (event) => {
            if (event.ctrlKey && event.key === "Enter") {
                // Prevent Ctrl + Enter from triggering autoComplete.
                event.stopImmediatePropagation();
                event.preventDefault();
                $el.trigger("autocomplete:selected", { action: "search-notes", noteTitle: $el.autocomplete("val") });
            }
        });
    }
    $el.on("keydown", async (event) => {
        if (event.shiftKey && event.key === "Enter") {
            // Prevent Enter from triggering autoComplete.
            event.stopImmediatePropagation();
            event.preventDefault();
            fullTextSearch($el, options);
        }
    });

    $el.autocomplete(
        {
            ...autocompleteOptions,
            appendTo: document.body,
            hint: false,
            autoselect: true,
            openOnFocus: false,
            minLength: 0,
            tabAutocomplete: false,
        },
        [
            {
                source: (term, callback) => {
                    clearTimeout(debounceTimeoutId);
                    debounceTimeoutId = setTimeout(() => {
                        if (!isComposingInput) {
                            autocompleteSource(term, callback, options);
                        }
                    }, searchDelay);

                    if (searchDelay === 0) {
                        searchDelay = getSearchDelay(notesCount);
                    }
                },
                displayKey: "notePathTitle",
                templates: { suggestion: renderSuggestion },
                cache: false,
            },
        ]
    );

    // TODO: Types fail due to "autocomplete:selected" not being registered in type definitions.
    ($el as any).on("autocomplete:selected", async (event: Event, suggestion: Suggestion) => {
        async function doCommand() {
            $el.autocomplete("close");
            $el.trigger("autocomplete:commandselected", [suggestion]);
        }

        async function doExternalLink() {
            $el.setSelectedNotePath(null);
            $el.setSelectedExternalLink(suggestion.externalLink);
            $el.autocomplete("val", suggestion.externalLink);
            $el.autocomplete("close");
            $el.trigger("autocomplete:externallinkselected", [suggestion]);
        }

        async function resolveSuggestionNotePathUnderCurrentHoist(note: FNote) {
            const hoisted = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            suggestion.notePath = note.getBestNotePathString(hoisted);
        }

        async function doSearchNotes() {
            const searchString = suggestion.noteTitle;
            appContext.triggerCommand("searchNotes", { searchString });
        }

        async function selectNoteFromAutocomplete(suggestion: Suggestion) {
            $el.setSelectedNotePath(suggestion.notePath);
            $el.setSelectedExternalLink(null);

            $el.autocomplete("val", suggestion.noteTitle);

            $el.autocomplete("close");

            $el.trigger("autocomplete:noteselected", [suggestion]);
        }

        switch (suggestion.action) {
            case SuggestionAction.Command:
                await doCommand();
                return;

            case SuggestionAction.ExternalLink:
                await doExternalLink();
                break;

            case SuggestionAction.CreateNote: {
                const { note } = await noteCreateService.createNote(
                    {
                        target: "inbox",
                        title: suggestion.noteTitle,
                        activate: true,
                        promptForType: true,
                    }
                );

                if (!note) break;

                await resolveSuggestionNotePathUnderCurrentHoist(note);
                await selectNoteFromAutocomplete(suggestion);
                break;
            }

            case SuggestionAction.CreateAndLinkNote: {
                const { note } = await noteCreateService.createNote(
                    {
                        target: "inbox",
                        title: suggestion.noteTitle,
                        activate: false,
                        promptForType: true,
                    }
                );

                if (!note) break;

                await resolveSuggestionNotePathUnderCurrentHoist(note);
                await selectNoteFromAutocomplete(suggestion);
                break;
            }

            case SuggestionAction.CreateChildNote: {
                if (!suggestion.parentNoteId) {
                    console.warn("Missing parentNoteId for CreateNoteIntoPath");
                    return;
                }

                const { note } = await noteCreateService.createNote(
                    {
                        target: "into",
                        parentNoteUrl: suggestion.parentNoteId,
                        title: suggestion.noteTitle,
                        activate: true,
                        promptForType: true,
                    },
                );

                if (!note) break;

                await resolveSuggestionNotePathUnderCurrentHoist(note);
                await selectNoteFromAutocomplete(suggestion);
                break;
            }

            case SuggestionAction.CreateAndLinkChildNote: {
                if (!suggestion.parentNoteId) {
                    console.warn("Missing parentNoteId for CreateNoteIntoPath");
                    return;
                }

                const { note } = await noteCreateService.createNote(
                    {
                        target: "into",
                        parentNoteUrl: suggestion.parentNoteId,
                        title: suggestion.noteTitle,
                        activate: false,
                        promptForType: true,
                    }
                );

                if (!note) break;

                await resolveSuggestionNotePathUnderCurrentHoist(note);
                await selectNoteFromAutocomplete(suggestion);
                break;
            }

            case SuggestionAction.SearchNotes:
                await doSearchNotes();
                break;

            default:
                await selectNoteFromAutocomplete(suggestion);
        }
    });

    $el.on("autocomplete:closed", () => {
        if (!String($el.val())?.trim()) {
            clearText($el);
        }
    });

    $el.on("autocomplete:opened", () => {
        if ($el.attr("readonly")) {
            $el.autocomplete("close");
        }
    });

    // clear any event listener added in previous invocation of this function
    $el.off("autocomplete:noteselected");

    return $el;
}

function init() {
    $.fn.getSelectedNotePath = function () {
        if (!String($(this).val())?.trim()) {
            return "";
        } else {
            return $(this).attr(SELECTED_NOTE_PATH_KEY);
        }
    };

    $.fn.getSelectedNoteId = function () {
        const $el = $(this as unknown as HTMLElement);
        const notePath = $el.getSelectedNotePath();
        if (!notePath) {
            return null;
        }

        const chunks = notePath.split("/");

        return chunks.length >= 1 ? chunks[chunks.length - 1] : null;
    };

    $.fn.setSelectedNotePath = function (notePath) {
        notePath = notePath || "";
        $(this).attr(SELECTED_NOTE_PATH_KEY, notePath);
        $(this).closest(".input-group").find(".go-to-selected-note-button").toggleClass("disabled", !notePath.trim()).attr("href", `#${notePath}`); // we also set href here so tooltip can be displayed
    };

    $.fn.getSelectedExternalLink = function () {
        if (!String($(this).val())?.trim()) {
            return "";
        } else {
            return $(this).attr(SELECTED_EXTERNAL_LINK_KEY);
        }
    };

    $.fn.setSelectedExternalLink = function (externalLink: string | null) {
        $(this).attr(SELECTED_EXTERNAL_LINK_KEY, externalLink);
        $(this).closest(".input-group").find(".go-to-selected-note-button").toggleClass("disabled", true);
    };

    $.fn.setNote = async function (noteId) {
        const note = noteId ? await froca.getNote(noteId, true) : null;

        $(this)
            .val(note ? note.title : "")
            .setSelectedNotePath(noteId);
    };
}

/**
 * Convenience function which triggers the display of recent notes in the autocomplete input and focuses it.
 *
 * @param inputElement - The input element to trigger recent notes on.
 */
export function triggerRecentNotes(inputElement: HTMLInputElement | null | undefined) {
    if (!inputElement) {
        return;
    }

    const $el = $(inputElement);
    showRecentNotes($el);
    $el.trigger("focus").trigger("select");
}

export default {
    autocompleteSourceForCKEditor,
    initNoteAutocomplete,
    showRecentNotes,
    showAllCommands,
    setText,
    init
};
