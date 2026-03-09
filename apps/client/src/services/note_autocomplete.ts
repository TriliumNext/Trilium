import type { AutocompleteApi as CoreAutocompleteApi, BaseItem } from "@algolia/autocomplete-core";
import { createAutocomplete } from "@algolia/autocomplete-core";
import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";

import appContext from "../components/app_context.js";
import { bindAutocompleteInput, createHeadlessPanelController, registerHeadlessAutocompleteCloser, withHeadlessSourceDefaults } from "./autocomplete_core.js";
import commandRegistry from "./command_registry.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import noteCreateService from "./note_create.js";
import server from "./server.js";

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
    clearCursor: () => void;
    isPanelOpen: () => boolean;
    suppressNextClosedReset: () => void;
    showQuery: (query: string) => void;
    openRecentNotes: () => void;
    cleanup: () => void;
}

const instanceMap = new WeakMap<HTMLElement, ManagedInstance>();

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function sanitizeHighlightedHtml(text: string, { allowBreaks = false }: { allowBreaks?: boolean } = {}): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const safeOutput = document.createDocumentFragment();

    const processNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            safeOutput.appendChild(document.createTextNode(node.textContent || ""));
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (el.tagName === "B") {
                const b = document.createElement("b");
                b.textContent = el.textContent; // Only extract text, stripping nested potential danger
                safeOutput.appendChild(b);
            } else if (el.tagName === "BR" && allowBreaks) {
                safeOutput.appendChild(document.createElement("br"));
            } else {
                // If the tag is not allowed, just extract its text content securely
                safeOutput.appendChild(document.createTextNode(el.textContent || ""));
            }
        }
    };

    doc.body.childNodes.forEach(processNode);

    const tmpDiv = document.createElement("div");
    tmpDiv.appendChild(safeOutput);
    return tmpDiv.innerHTML;
}

function normalizeAttributeSnippet(snippet: string): string {
    return sanitizeHighlightedHtml(snippet, { allowBreaks: true })
        .replace(/<br\s*\/?>/gi, " <span class=\"aa-core-separator\">&middot;</span> ");
}

function getSuggestionIconClass(item: Suggestion): string {
    if (item.action === "search-notes") {
        return "bx bx-search";
    }
    if (item.action === "create-note") {
        return "bx bx-plus";
    }
    if (item.action === "external-link") {
        return "bx bx-link-external";
    }

    return item.icon || "bx bx-note";
}

function getSuggestionInputValue(item: Suggestion): string {
    return item.noteTitle || item.notePathTitle || item.externalLink || "";
}

function renderCommandSuggestion(item: Suggestion): string {
    const iconClass = escapeHtml(item.icon || "bx bx-terminal");
    const titleHtml = item.highlightedNotePathTitle
        ? sanitizeHighlightedHtml(item.highlightedNotePathTitle)
        : escapeHtml(item.noteTitle || "");
    const descriptionHtml = item.commandDescription ? `<div class="command-description">${escapeHtml(item.commandDescription)}</div>` : "";
    const shortcutHtml = item.commandShortcut ? `<kbd class="command-shortcut">${escapeHtml(item.commandShortcut)}</kbd>` : "";

    return `
        <div class="command-suggestion">
            <span class="command-icon ${iconClass}"></span>
            <div class="command-content">
                <div class="command-name">${titleHtml}</div>
                ${descriptionHtml}
            </div>
            ${shortcutHtml}
        </div>
    `;
}

function renderNoteSuggestion(item: Suggestion): string {
    const iconClass = escapeHtml(getSuggestionIconClass(item));
    const titleHtml = item.highlightedNotePathTitle
        ? sanitizeHighlightedHtml(item.highlightedNotePathTitle)
        : escapeHtml(item.noteTitle || item.notePathTitle || item.externalLink || "");
    const shortcutHtml = item.action === "search-notes"
        ? `<kbd class="aa-core-shortcut">Ctrl+Enter</kbd>`
        : "";
    const attributeHtml = item.highlightedAttributeSnippet
        ? `<div class="search-result-attributes">${normalizeAttributeSnippet(item.highlightedAttributeSnippet)}</div>`
        : "";
    const contentClass = item.action === "search-notes" ? "note-suggestion search-notes-action" : "note-suggestion";

    return `
        <div class="${contentClass}">
            <span class="icon ${iconClass}"></span>
            <span class="text">
                <span class="aa-core-primary-row">
                    <span class="search-result-title">${titleHtml}</span>
                    ${shortcutHtml}
                </span>
                ${attributeHtml}
            </span>
        </div>
    `;
}

function renderSuggestion(item: Suggestion): string {
    if (item.action === "command") {
        return renderCommandSuggestion(item);
    }

    return renderNoteSuggestion(item);
}

function createSuggestionSource(options: Options, onSelectItem: (item: Suggestion) => void) {
    return withHeadlessSourceDefaults<Suggestion>({
        sourceId: "note-suggestions",
        async getItems({ query }: { query: string }) {
            return await fetchResolvedSuggestions(query, options);
        },
        getItemInputValue({ item }: { item: Suggestion }) {
            return getSuggestionInputValue(item);
        },
        onSelect({ item }: { item: Suggestion }) {
            void onSelectItem(item);
        }
    });
}

function renderItems(
    panelEl: HTMLElement,
    items: Suggestion[],
    activeId: number | null,
    onSelect: (item: Suggestion) => void | Promise<void>,
    onActivate: (index: number) => void,
    onDeactivate: () => void
) {
    if (items.length === 0) {
        panelEl.style.display = "none";
        return;
    }

    const list = document.createElement("div");
    list.className = "aa-core-list aa-suggestions";
    list.setAttribute("role", "listbox");

    items.forEach((item, index) => {
        const itemEl = document.createElement("div");
        itemEl.className = "aa-core-item aa-suggestion";
        itemEl.setAttribute("role", "option");
        itemEl.setAttribute("aria-selected", index === activeId ? "true" : "false");
        itemEl.dataset.index = String(index);

        if (item.action) {
            itemEl.classList.add(`${item.action}-action`);
        }
        if (index === activeId) {
            itemEl.classList.add("aa-core-item--active", "aa-cursor");
        }

        itemEl.innerHTML = renderSuggestion(item);
        itemEl.onmousemove = () => {
            if (activeId === index) {
                return;
            }

            onDeactivate();
            window.setTimeout(() => {
                onActivate(index);
            }, 0);
        };
        itemEl.onmouseleave = (event) => {
            const relatedTarget = event.relatedTarget;
            if (relatedTarget instanceof HTMLElement && itemEl.contains(relatedTarget)) {
                return;
            }

            onDeactivate();
        };
        itemEl.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            void onSelect(item);
        };

        list.appendChild(itemEl);
    });

    panelEl.innerHTML = "";
    panelEl.appendChild(list);
    panelEl.style.display = "block";
}

async function autocompleteSourceForCKEditor(queryText: string) {
    const rows = await fetchResolvedSuggestions(queryText, { allowCreatingNotes: true });
    return rows.map((row) => {
        return {
            action: row.action,
            noteTitle: row.noteTitle,
            id: `@${row.notePathTitle}`,
            name: row.notePathTitle || "",
            link: `#${row.notePath}`,
            notePath: row.notePath,
            highlightedNotePathTitle: row.highlightedNotePathTitle
        };
    });
}

function getSearchingSuggestion(term: string): Suggestion[] {
    if (term.trim().length === 0) {
        return [];
    }

    return [
        {
            noteTitle: term,
            highlightedNotePathTitle: t("quick-search.searching")
        }
    ];
}

async function fetchResolvedSuggestions(term: string, options: Options = {}): Promise<Suggestion[]> {
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

        return commandSuggestions;
    }

    const fastSearch = options.fastSearch !== false;
    if (fastSearch === false) {
        if (term.trim().length === 0) {
            return [];
        }
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
                highlightedNotePathTitle: t("note_autocomplete.search-for", { term })
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

    return results;
}

async function fetchSuggestionsWithDelay(term: string, options: Options): Promise<Suggestion[]> {
    return await new Promise<Suggestion[]>((resolve) => {
        clearTimeout(debounceTimeoutId);
        debounceTimeoutId = setTimeout(async () => {
            resolve(await fetchResolvedSuggestions(term, options));
        }, searchDelay);

        if (searchDelay === 0) {
            searchDelay = getSearchDelay(notesCount);
        }
    });
}

function resetSelectionState($el: JQuery<HTMLElement>) {
    $el.setSelectedNotePath("");
    $el.setSelectedExternalLink(null);
}

function getManagedInstance($el: JQuery<HTMLElement>): ManagedInstance | null {
    const inputEl = $el[0] as HTMLInputElement | undefined;
    return inputEl ? (instanceMap.get(inputEl) ?? null) : null;
}

async function handleSuggestionSelection(
    $el: JQuery<HTMLElement>,
    autocomplete: CoreAutocompleteApi<Suggestion>,
    inputEl: HTMLInputElement,
    suggestion: Suggestion
) {
    if (suggestion.action === "command") {
        autocomplete.setIsOpen(false);
        $el.trigger("autocomplete:commandselected", [suggestion]);
        return;
    }

    if (suggestion.action === "external-link") {
        $el.setSelectedNotePath(null);
        $el.setSelectedExternalLink(suggestion.externalLink ?? null);
        inputEl.value = suggestion.externalLink ?? "";
        autocomplete.setIsOpen(false);
        $el.trigger("autocomplete:externallinkselected", [suggestion]);
        return;
    }

    if (suggestion.action === "create-note") {
        const { success, noteType, templateNoteId, notePath } = await noteCreateService.chooseNoteType();
        if (!success) {
            return;
        }

        const { note } = await noteCreateService.createNote(notePath || suggestion.parentNoteId, {
            title: suggestion.noteTitle,
            activate: false,
            type: noteType,
            templateNoteId
        });

        const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
        suggestion.notePath = note?.getBestNotePathString(hoistedNoteId);
    }

    if (suggestion.action === "search-notes") {
        const searchString = suggestion.noteTitle;
        autocomplete.setIsOpen(false);
        await appContext.triggerCommand("searchNotes", { searchString });
        return;
    }

    $el.setSelectedNotePath(suggestion.notePath || "");
    $el.setSelectedExternalLink(null);
    inputEl.value = suggestion.noteTitle || getSuggestionInputValue(suggestion);
    autocomplete.setIsOpen(false);
    $el.trigger("autocomplete:noteselected", [suggestion]);
}

export function clearText($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    resetSelectionState($el);
    const inputEl = $el[0] as HTMLInputElement;
    const instance = getManagedInstance($el);
    if (instance) {
        if (instance.isPanelOpen()) {
            instance.suppressNextClosedReset();
        }
        inputEl.value = "";
        instance.clearCursor();
        instance.autocomplete.setQuery("");
        instance.autocomplete.setIsOpen(false);
        instance.autocomplete.refresh();
        $el.trigger("change");
    }
}

function setText($el: JQuery<HTMLElement>, text: string) {
    resetSelectionState($el);
    const instance = getManagedInstance($el);
    if (instance) {
        instance.showQuery(text.trim());
    }
}

function showRecentNotes($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    resetSelectionState($el);
    const instance = getManagedInstance($el);
    if (instance) {
        instance.openRecentNotes();
    }
    $el.trigger("focus");
}

function showAllCommands($el: JQuery<HTMLElement>) {
    searchDelay = 0;
    resetSelectionState($el);
    const instance = getManagedInstance($el);
    if (instance) {
        instance.showQuery(">");
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
    resetSelectionState($el);

    const instance = getManagedInstance($el);
    if (instance) {
        instance.clearCursor();
        instance.autocomplete.setQuery("");
        inputEl.value = "";
        instance.showQuery(searchString);
    }
}

function initNoteAutocomplete($el: JQuery<HTMLElement>, options?: Options) {
    $el.addClass("note-autocomplete-input");
    const inputEl = $el[0] as HTMLInputElement;

    if (instanceMap.has(inputEl)) {
        $el
            .off("autocomplete:noteselected")
            .off("autocomplete:externallinkselected")
            .off("autocomplete:commandselected");
        return $el;
    }

    options = options || {};
    let isComposingInput = false;

    const panelController = createHeadlessPanelController({
        inputEl,
        container: options.container,
        className: "aa-core-panel aa-dropdown-menu"
    });
    const { panelEl } = panelController;
    let currentQuery = inputEl.value;
    let shouldAutoselectTopItem = false;
    let shouldMirrorActiveItemToInput = false;
    let wasPanelOpen = false;
    let suppressNextClosedEmptyReset = false;
    let suggestionRequestId = 0;

    const clearCursor = () => {
        shouldMirrorActiveItemToInput = false;
        autocomplete.setActiveItemId(null);
        inputEl.value = currentQuery;
    };

    const suppressNextClosedReset = () => {
        suppressNextClosedEmptyReset = true;
    };

    const prepareForQueryChange = () => {
        shouldAutoselectTopItem = true;
        shouldMirrorActiveItemToInput = false;
    };

    const rerunQuery = (query: string) => {
        if (!query.trim().length) {
            openRecentNotes();
            return;
        }

        prepareForQueryChange();
        currentQuery = "";
        inputEl.value = "";
        autocomplete.setQuery("");
        showQuery(query);
    };

    const onSelectItem = async (item: Suggestion) => {
        await handleSuggestionSelection($el, autocomplete, inputEl, item);
    };

    const source = createSuggestionSource(options, onSelectItem);

    const showQuery = (query: string) => {
        prepareForQueryChange();
        inputEl.value = query;
        autocomplete.setQuery(query);
        autocomplete.setIsOpen(true);
        autocomplete.refresh();
    };

    const openRecentNotes = () => {
        resetSelectionState($el);
        prepareForQueryChange();
        inputEl.value = "";
        autocomplete.setQuery("");
        autocomplete.setActiveItemId(null);

        fetchResolvedSuggestions("", options).then((items) => {
            autocomplete.setCollections([{ source, items }]);
            autocomplete.setActiveItemId(items.length > 0 ? 0 : null);
            autocomplete.setIsOpen(items.length > 0);
        });
    };

    const autocomplete = createAutocomplete<Suggestion>({
        openOnFocus: false, // Wait until we explicitly focus or type
        // Old autocomplete.js used `autoselect: true`, so the first item
        // should be immediately selectable when the panel opens.
        defaultActiveItemId: 0,
        shouldPanelOpen() {
            return true;
        },

        getSources({ query }) {
            return [
                {
                    ...source,
                    async getItems() {
                        if (isComposingInput) {
                            return [];
                        }

                        if (options.fastSearch === false && query.trim().length > 0) {
                            const requestId = ++suggestionRequestId;

                            void fetchSuggestionsWithDelay(query, options).then((items) => {
                                if (requestId !== suggestionRequestId || currentQuery !== query) {
                                    return;
                                }

                                autocomplete.setCollections([{ source, items }]);
                                autocomplete.setIsOpen(items.length > 0);
                            });

                            return getSearchingSuggestion(query);
                        }

                        return await fetchSuggestionsWithDelay(query, options);
                    }
                },
            ];
        },

        onStateChange({ state }) {
            const collections = state.collections;
            const items = collections.length > 0 ? (collections[0].items as Suggestion[]) : [];
            const activeId = state.activeItemId ?? null;
            const activeItem = activeId !== null ? items[activeId] : null;
            currentQuery = state.query;
            const isPanelOpen = state.isOpen && items.length > 0;

            if (isPanelOpen !== wasPanelOpen) {
                wasPanelOpen = isPanelOpen;

                if (isPanelOpen) {
                    $el.trigger("autocomplete:opened");

                    if (inputEl.readOnly) {
                        suppressNextClosedReset();
                        autocomplete.setIsOpen(false);
                        return;
                    }
                } else {
                    $el.trigger("autocomplete:closed");

                    if (suppressNextClosedEmptyReset) {
                        suppressNextClosedEmptyReset = false;
                    } else if (!String(inputEl.value).trim()) {
                        searchDelay = 0;
                        resetSelectionState($el);
                        $el.trigger("change");
                    }
                }
            }

            if (activeItem && shouldMirrorActiveItemToInput) {
                inputEl.value = getSuggestionInputValue(activeItem);
            } else {
                inputEl.value = state.query;
            }

            if (isPanelOpen) {
                renderItems(panelEl, items, activeId, (item) => {
                    void onSelectItem(item);
                }, (index) => {
                    autocomplete.setActiveItemId(index);
                }, () => {
                    clearCursor();
                });

                if (shouldAutoselectTopItem && activeId === null) {
                    shouldAutoselectTopItem = false;
                    shouldMirrorActiveItemToInput = false;
                    autocomplete.setActiveItemId(0);
                    return;
                }

                panelController.startPositioning();
            } else {
                shouldAutoselectTopItem = false;
                panelController.hide();
            }
        },
    });

    const unregisterGlobalCloser = registerHeadlessAutocompleteCloser(() => {
        autocomplete.setIsOpen(false);
        panelController.hide();
    });

    const onCompositionStart = () => {
        isComposingInput = true;
    };
    const onCompositionEnd = (e: CompositionEvent) => {
        isComposingInput = false;
        rerunQuery(inputEl.value);
    };

    const cleanupInputBindings = bindAutocompleteInput<Suggestion>({
        inputEl,
        autocomplete,
        onInput(e, handlers) {
            const value = (e.currentTarget as HTMLInputElement).value;
            if (value.trim().length === 0) {
                openRecentNotes();
                return;
            }

            prepareForQueryChange();
            handlers.onChange(e as any);
        },
        onFocus(e, handlers) {
            if (inputEl.readOnly) {
                autocomplete.setIsOpen(false);
                panelController.hide();
                return;
            }
            handlers.onFocus(e as any);
        },
        onBlur() {
            if (options.container) {
                return;
            }
            setTimeout(() => {
                autocomplete.setIsOpen(false);
                panelController.hide();
            }, 50);
        },
        onKeyDown(e, handlers) {
            if (options.allowJumpToSearchNotes && e.ctrlKey && e.key === "Enter") {
                e.stopImmediatePropagation();
                e.preventDefault();
                void handleSuggestionSelection($el, autocomplete, inputEl, {
                    action: "search-notes",
                    noteTitle: inputEl.value
                });
                return;
            }

            if (e.shiftKey && e.key === "Enter") {
                e.stopImmediatePropagation();
                e.preventDefault();
                fullTextSearch($el, options);
                return;
            }

            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                shouldMirrorActiveItemToInput = true;
            }
            handlers.onKeyDown(e as any);
        },
        extraBindings: [
            { type: "compositionstart", listener: onCompositionStart },
            { type: "compositionend", listener: onCompositionEnd }
        ]
    });

    const cleanup = () => {
        unregisterGlobalCloser();
        cleanupInputBindings();
        autocomplete.destroy();
        panelController.destroy();
    };

    instanceMap.set(inputEl, {
        autocomplete,
        panelEl,
        clearCursor,
        isPanelOpen: () => wasPanelOpen,
        suppressNextClosedReset,
        showQuery,
        openRecentNotes,
        cleanup
    });

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

export function destroyAutocomplete($el: JQuery<HTMLElement> | HTMLElement) {
    const inputEl = $el instanceof HTMLElement ? $el : $el[0] as HTMLInputElement;
    const instance = instanceMap.get(inputEl);
    if (instance) {
        instance.cleanup();
        instanceMap.delete(inputEl);
    }
}

function init() {
    $.fn.getSelectedNotePath = function () {
        if (!String($(this).val())?.trim()) {
            return "";
        }
        return $(this).attr(SELECTED_NOTE_PATH_KEY);

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
        }
        return $(this).attr(SELECTED_EXTERNAL_LINK_KEY);

    };

    $.fn.setSelectedExternalLink = function (externalLink: string | null) {
        $(this).attr(SELECTED_EXTERNAL_LINK_KEY, externalLink);
        $(this).closest(".input-group").find(".go-to-selected-note-button").toggleClass("disabled", true);
    };

    $.fn.setNote = async function (noteId) {
        const note = noteId ? await froca.getNote(noteId, true) : null;
        const $el = $(this as unknown as HTMLElement);
        const instance = getManagedInstance($el);
        const noteTitle = note ? note.title : "";

        $el
            .val(noteTitle)
            .setSelectedNotePath(noteId);

        if (instance) {
            instance.clearCursor();
            instance.autocomplete.setQuery(noteTitle);
            instance.autocomplete.setIsOpen(false);
        }
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
    clearText,
    destroyAutocomplete,
    initNoteAutocomplete,
    showRecentNotes,
    showAllCommands,
    setText,
    init
};
