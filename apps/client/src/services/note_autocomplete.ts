import { createAutocomplete } from "@algolia/autocomplete-core";
import type { AutocompleteApi as CoreAutocompleteApi, BaseItem } from "@algolia/autocomplete-core";
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
export interface Suggestion extends BaseItem {
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

// --- Headless Autocomplete Helpers ---
interface ManagedInstance {
    autocomplete: CoreAutocompleteApi<Suggestion>;
    panelEl: HTMLElement;
    cleanup: () => void;
}

const instanceMap = new WeakMap<HTMLElement, ManagedInstance>();

function createPanelEl(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "aa-core-panel";
    panel.style.display = "none";
    document.body.appendChild(panel);
    return panel;
}

function positionPanel(panelEl: HTMLElement, inputEl: HTMLElement): void {
    const rect = inputEl.getBoundingClientRect();
    panelEl.style.position = "fixed";
    panelEl.style.top = `${rect.bottom}px`;
    panelEl.style.left = `${rect.left}px`;
    panelEl.style.width = `${rect.width}px`;
    panelEl.style.display = "block";
}

function renderItems(panelEl: HTMLElement, items: Suggestion[], activeId: number | null, onSelect: (item: Suggestion) => void) {
    if (items.length === 0) {
        panelEl.style.display = "none";
        return;
    }
    const list = document.createElement("ul");
    list.className = "aa-core-list";
    items.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = "aa-core-item";
        if (index === activeId) li.classList.add("aa-core-item--active");
        
        // Very basic simple UI for step 3.1
        li.textContent = item.highlightedNotePathTitle || item.noteTitle || "";
        li.onmousedown = (e) => { e.preventDefault(); onSelect(item); };
        list.appendChild(li);
    });
    panelEl.innerHTML = "";
    panelEl.appendChild(list);
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
    const inputEl = $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        inputEl.value = "";
        instance.autocomplete.setQuery("");
        instance.autocomplete.setIsOpen(false);
        instance.autocomplete.refresh();
    }
}

function setText($el: JQuery<HTMLElement>, text: string) {
    $el.setSelectedNotePath("");
    const inputEl = $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        inputEl.value = text.trim();
        instance.autocomplete.setQuery(text.trim());
        instance.autocomplete.setIsOpen(true);
        instance.autocomplete.refresh();
    }
}

function showRecentNotes($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    $el.setSelectedNotePath("");
    const inputEl = $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        inputEl.value = "";
        instance.autocomplete.setQuery("");
        instance.autocomplete.setIsOpen(true);
        instance.autocomplete.refresh();
    }
    $el.trigger("focus");
}

function showAllCommands($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    $el.setSelectedNotePath("");
    const inputEl = $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        inputEl.value = ">";
        instance.autocomplete.setQuery(">");
        instance.autocomplete.setIsOpen(true);
        instance.autocomplete.refresh();
    }
}

function fullTextSearch($el: JQuery<HTMLElement>, options: Options) {
    const inputEl = $el[0] as HTMLInputElement;
    const searchString = inputEl.value;
    if (options.fastSearch === false || searchString.trim().length === 0) {
        return;
    }
    $el.trigger("focus");
    options.fastSearch = false;
    searchDelay = 0;
    
    const instance = instanceMap.get(inputEl);
    if (instance) {
        instance.autocomplete.setQuery(searchString);
        instance.autocomplete.setIsOpen(true);
        instance.autocomplete.refresh();
    }
}

function initNoteAutocomplete($el: JQuery<HTMLElement>, options?: Options) {
    $el.addClass("note-autocomplete-input");
    const inputEl = $el[0] as HTMLInputElement;

    if (instanceMap.has(inputEl)) {
        return $el;
    }

    options = options || {};

    const panelEl = createPanelEl();
    let rafId: number | null = null;
    function startPositioning() {
        if (rafId !== null) return;
        const update = () => {
            positionPanel(panelEl, inputEl);
            rafId = requestAnimationFrame(update);
        };
        update();
    }
    function stopPositioning() {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    const autocomplete = createAutocomplete<Suggestion>({
        openOnFocus: false, // Wait until we explicitly focus or type
        defaultActiveItemId: null,
        shouldPanelOpen() {
            return true;
        },

        getSources({ query }) {
            return [
                {
                    sourceId: "note-suggestions",
                    async getItems() {
                        return new Promise<Suggestion[]>((resolve) => {
                            clearTimeout(debounceTimeoutId);
                            debounceTimeoutId = setTimeout(() => {
                                autocompleteSource(query, resolve, options!);
                            }, searchDelay);

                            if (searchDelay === 0) {
                                searchDelay = getSearchDelay(notesCount);
                            }
                        });
                    },
                    getItemInputValue({ item }) {
                        return item.noteTitle || item.notePathTitle || "";
                    },
                    onSelect({ item }) {
                        inputEl.value = item.noteTitle || item.notePathTitle || "";
                        autocomplete.setIsOpen(false);
                        
                        // Fake selection handler for step 3.1
                        $el.trigger("autocomplete:noteselected", [item]);
                    },
                },
            ];
        },

        onStateChange({ state }) {
            const collections = state.collections;
            const items = collections.length > 0 ? (collections[0].items as Suggestion[]) : [];
            const activeId = state.activeItemId ?? null;

            if (state.isOpen && items.length > 0) {
                renderItems(panelEl, items, activeId, (item) => {
                    inputEl.value = item.noteTitle || item.notePathTitle || "";
                    autocomplete.setIsOpen(false);
                    // Also dispatch selected event
                    $el.trigger("autocomplete:noteselected", [item]);
                });
                startPositioning();
            } else {
                panelEl.style.display = "none";
                stopPositioning();
            }
        },
    });

    const handlers = autocomplete.getInputProps({ inputElement: inputEl });
    const onInput = (e: Event) => {
        handlers.onChange(e as any);
    };
    const onFocus = (e: Event) => {
        handlers.onFocus(e as any);
    };
    const onBlur = () => {
        setTimeout(() => {
            autocomplete.setIsOpen(false);
            panelEl.style.display = "none";
            stopPositioning();
        }, 50);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        handlers.onKeyDown(e as any);
    };

    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("focus", onFocus);
    inputEl.addEventListener("blur", onBlur);
    inputEl.addEventListener("keydown", onKeyDown);

    const cleanup = () => {
        inputEl.removeEventListener("input", onInput);
        inputEl.removeEventListener("focus", onFocus);
        inputEl.removeEventListener("blur", onBlur);
        inputEl.removeEventListener("keydown", onKeyDown);
        stopPositioning();
        if (panelEl.parentElement) {
            panelEl.parentElement.removeChild(panelEl);
        }
    };

    instanceMap.set(inputEl, { autocomplete, panelEl, cleanup });

    // Buttons UI logic
    const $clearTextButton = $("<a>").addClass("input-group-text input-clearer-button bx bxs-tag-x").prop("title", t("note_autocomplete.clear-text-field"));
    const $showRecentNotesButton = $("<a>").addClass("input-group-text show-recent-notes-button bx bx-time").prop("title", t("note_autocomplete.show-recent-notes"));
    const $fullTextSearchButton = $("<a>").addClass("input-group-text full-text-search-button bx bx-search").prop("title", `${t("note_autocomplete.full-text-search")} (Shift+Enter)`);
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
        return false;
    });
    $fullTextSearchButton.on("click", (e) => {
        fullTextSearch($el, options!);
        return false;
    });

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
