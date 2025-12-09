import server from "./server.js";
import appContext from "../components/app_context.js";
import noteCreateService from "./note_create.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import commandRegistry from "./command_registry.js";
import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";

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

// TODO: Deduplicate with server.
export interface Suggestion {
    noteTitle?: string;
    externalLink?: string;
    notePathTitle?: string;
    notePath?: string;
    highlightedNotePathTitle?: string;
    action?: string | "create-note" | "search-notes" | "external-link" | "command";
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

async function autocompleteSourceForCKEditor(queryText: string) {
    return await new Promise<MentionFeedObjectItem[]>((res, rej) => {
        autocompleteSource(
            queryText,
            (rows) => {
                res(
                    rows.map((row) => {
                        return {
                            action: row.action,
                            noteTitle: row.noteTitle,
                            id: `@${row.notePathTitle}`,
                            name: row.notePathTitle || "",
                            link: `#${row.notePath}`,
                            notePath: row.notePath,
                            highlightedNotePathTitle: row.highlightedNotePathTitle
                        };
                    })
                );
            },
            {
                allowCreatingNotes: true
            }
        );
    });
}

async function autocompleteSource(term: string, cb: (rows: Suggestion[]) => void, options: Options = {}) {
    // Check if we're in command mode
    if (options.isCommandPalette && term.startsWith(">")) {
        const commandQuery = term.substring(1).trim();

        // Get commands (all if no query, filtered if query provided)
        const commands = commandQuery.length === 0
            ? commandRegistry.getAllCommands()
            : commandRegistry.searchCommands(commandQuery);

        // Convert commands to suggestions
        const commandSuggestions: Suggestion[] = commands.map(cmd => ({
            action: "command",
            commandId: cmd.id,
            noteTitle: cmd.name,
            notePathTitle: `>${cmd.name}`,
            highlightedNotePathTitle: cmd.name,
            commandDescription: cmd.description,
            commandShortcut: cmd.shortcut,
            icon: cmd.icon
        }));

        cb(commandSuggestions);
        return;
    }

    const fastSearch = options.fastSearch === false ? false : true;
    if (fastSearch === false) {
        if (term.trim().length === 0) {
            return;
        }
        cb([
            {
                noteTitle: term,
                highlightedNotePathTitle: t("quick-search.searching")
            }
        ]);
    }

    const activeNoteId = appContext.tabManager.getActiveContextNoteId();
    const length = term.trim().length;

    let results = await server.get<Suggestion[]>(`autocomplete?query=${encodeURIComponent(term)}&activeNoteId=${activeNoteId}&fastSearch=${fastSearch}`);

    options.fastSearch = true;

    if (length >= 1 && options.allowCreatingNotes) {
        results = [
            {
                action: "create-note",
                noteTitle: term,
                parentNoteId: activeNoteId || "root",
                highlightedNotePathTitle: t("note_autocomplete.create-note", { term })
            } as Suggestion
        ].concat(results);
    }

    if (length >= 1 && options.allowJumpToSearchNotes) {
        results = results.concat([
            {
                action: "search-notes",
                noteTitle: term,
                highlightedNotePathTitle: `${t("note_autocomplete.search-for", { term })} <kbd style='color: var(--muted-text-color); background-color: transparent; float: right;'>Ctrl+Enter</kbd>`
            }
        ]);
    }

    if (term.match(/^[a-z]+:\/\/.+/i) && options.allowExternalLinks) {
        results = [
            {
                action: "external-link",
                externalLink: term,
                highlightedNotePathTitle: t("note_autocomplete.insert-external-link", { term })
            } as Suggestion
        ].concat(results);
    }

    cb(results);
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
            appendTo: document.querySelector("body"),
            hint: false,
            autoselect: true,
            // openOnFocus has to be false, otherwise re-focus (after return from note type chooser dialog) forces
            // re-querying of the autocomplete source which then changes the currently selected suggestion
            openOnFocus: false,
            minLength: 0,
            tabAutocomplete: false
        },
        [
            {
                source: (term, cb) => {
                    clearTimeout(debounceTimeoutId);
                    debounceTimeoutId = setTimeout(() => {
                        if (isComposingInput) {
                            return;
                        }
                        autocompleteSource(term, cb, options);
                    }, searchDelay);

                    if (searchDelay === 0) {
                        searchDelay = getSearchDelay(notesCount);
                    }
                },
                displayKey: "notePathTitle",
                templates: {
                    suggestion: (suggestion) => {
                        if (suggestion.action === "command") {
                            let html = `<div class="command-suggestion">`;
                            html += `<span class="command-icon ${suggestion.icon || "bx bx-terminal"}"></span>`;
                            html += `<div class="command-content">`;
                            html += `<div class="command-name">${suggestion.highlightedNotePathTitle}</div>`;
                            if (suggestion.commandDescription) {
                                html += `<div class="command-description">${suggestion.commandDescription}</div>`;
                            }
                            html += `</div>`;
                            if (suggestion.commandShortcut) {
                                html += `<kbd class="command-shortcut">${suggestion.commandShortcut}</kbd>`;
                            }
                            html += '</div>';
                            return html;
                        }
                        // Add special class for search-notes action
                        const actionClass = suggestion.action === "search-notes" ? "search-notes-action" : "";

                        // Choose appropriate icon based on action
                        let iconClass = suggestion.icon ?? "bx bx-note";
                        if (suggestion.action === "search-notes") {
                            iconClass = "bx bx-search";
                        } else if (suggestion.action === "create-note") {
                            iconClass = "bx bx-plus";
                        } else if (suggestion.action === "external-link") {
                            iconClass = "bx bx-link-external";
                        }

                        // Simplified HTML structure without nested divs
                        let html = `<div class="note-suggestion ${actionClass}">`;
                        html += `<span class="icon ${iconClass}"></span>`;
                        html += `<span class="text">`;
                        html += `<span class="search-result-title">${suggestion.highlightedNotePathTitle}</span>`;

                        // Add attribute snippet inline if available
                        if (suggestion.highlightedAttributeSnippet) {
                            html += `<span class="search-result-attributes">${suggestion.highlightedAttributeSnippet}</span>`;
                        }

                        html += `</span>`;
                        html += `</div>`;
                        return html;
                    }
                },
                // we can't cache identical searches because notes can be created / renamed, new recent notes can be added
                cache: false
            }
        ]
    );

    // TODO: Types fail due to "autocomplete:selected" not being registered in type definitions.
    ($el as any).on("autocomplete:selected", async (event: Event, suggestion: Suggestion) => {
        if (suggestion.action === "command") {
            $el.autocomplete("close");
            $el.trigger("autocomplete:commandselected", [suggestion]);
            return;
        }

        if (suggestion.action === "external-link") {
            $el.setSelectedNotePath(null);
            $el.setSelectedExternalLink(suggestion.externalLink);

            $el.autocomplete("val", suggestion.externalLink);

            $el.autocomplete("close");

            $el.trigger("autocomplete:externallinkselected", [suggestion]);

            return;
        }

        if (suggestion.action === "create-note") {
            const { success, noteType, templateNoteId, notePath } = await noteCreateService.chooseNoteType();
            if (!success) {
                return;
            }
            const { note } = await noteCreateService.createNote( notePath || suggestion.parentNoteId, {
                title: suggestion.noteTitle,
                activate: false,
                type: noteType,
                templateNoteId: templateNoteId
            });

            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            suggestion.notePath = note?.getBestNotePathString(hoistedNoteId);
        }

        if (suggestion.action === "search-notes") {
            const searchString = suggestion.noteTitle;
            appContext.triggerCommand("searchNotes", { searchString });
            return;
        }

        $el.setSelectedNotePath(suggestion.notePath);
        $el.setSelectedExternalLink(null);

        $el.autocomplete("val", suggestion.noteTitle);

        $el.autocomplete("close");

        $el.trigger("autocomplete:noteselected", [suggestion]);
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
