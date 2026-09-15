import { Dropdown, Tooltip } from "bootstrap";

import appContext from "../components/app_context.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import linkService, { calculateHash, type ViewScope } from "../services/link.js";
import server from "../services/server.js";
import shortcutService, { isAppShortcutChord, isIMEComposing } from "../services/shortcuts.js";
import utils, { handleRightToLeftPlacement } from "../services/utils.js";
import BasicWidget from "./basic_widget.js";

const TPL = /*html*/`
<div class="quick-search input-group input-group-sm">
  <style>
    .quick-search {
        padding: 10px 10px 10px 0px;
        height: 50px;
    }

    .quick-search button, .quick-search input {
        border: 0;
        font-size: 100% !important;
    }

    .quick-search .dropdown-menu {
        --quick-search-item-delimiter-color: var(--dropdown-border-color);

        max-height: 80vh;
        min-width: 400px;
        max-width: 720px;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: -30px 50px 93px -50px black;
    }

    /* Bootstrap opens the menu by switching display, so the column only applies to the open menu. */
    .quick-search .dropdown-menu.show {
        display: flex;
        flex-direction: column;
    }

    .quick-search .quick-search-results {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .quick-search .quick-search-footer {
        flex: 0 0 auto;
    }

    .quick-search .dropdown-item {
        white-space: normal;
        padding: 12px 16px;
        line-height: 1.4;
        position: relative;
    }

    .quick-search .dropdown-item + .dropdown-item::after {
        content: '';
        position: absolute;
        inset-inline-start: 0;
        top: 0;
        width: 100%;
        height: 1px;
        border-bottom: 1px solid var(--quick-search-item-delimiter-color);
    }

    .quick-search .dropdown-item:last-child::after {
        display: none;
    }

    .quick-search .dropdown-item.disabled::after {
        display: none;
    }

    /* Mouse hover and the ArrowDown keyboard selection share the "active item" fill the rest
       of the menus use, so pointing at a result and arrowing to it look the same. */
    .quick-search .dropdown-item:not(.disabled):hover,
    .quick-search .dropdown-item:not(.disabled):focus {
        background-color: var(--active-item-background-color);
        color: var(--active-item-text-color);
        outline: none;
    }

     .quick-search .quick-search-item {
        width: 100%;
    }

    .quick-search .quick-search-item-header {
        padding: 0 8px;
    }

    .quick-search .quick-search-item-icon {
        margin-inline-end: 2px;
    }

    .quick-search .search-result-title {
        font-weight: 500;
    }

    .quick-search .search-result-attributes {
        opacity: .5;
        padding: 0 8px;
        font-size: .75em;
    }

    .quick-search .search-result-content {
        margin-top: 8px;
        padding: 8px;
        background-color: var(--accented-background-color);
        color: var(--main-text-color);
        font-size: .85em;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Search result highlighting: point at the same highlight vars the snippet cards
       (SearchResultsList.css / ListOrGridView.css) use, falling back to the pre-existing
       colors if a theme hasn't defined them. */
    .quick-search .search-result-title b,
    .quick-search .search-result-content b,
    .quick-search .search-result-attributes b {
        background: var(--note-list-view-search-result-highlight-background, transparent);
        color: var(--note-list-view-search-result-highlight-color, var(--admonition-warning-accent-color));
        font-weight: 600;
        text-decoration: underline;
    }

    .quick-search .search-result-title b.search-fuzzy-match,
    .quick-search .search-result-content b.search-fuzzy-match,
    .quick-search .search-result-attributes b.search-fuzzy-match {
        color: var(--quick-search-result-fuzzy-highlight-color, #e47b19);
        font-weight: 400;
        text-decoration: underline dotted;
    }

    .quick-search .dropdown-divider {
        margin: 0;
    }

    .quick-search .bx-loader {
        margin-inline-end: 4px;
    }

  </style>

  <div class="input-group-prepend">
    <button class="btn btn-outline-secondary search-button" type="button" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
        <span class="bx bx-search"></span>
    </button>
    <div class="dropdown-menu tn-dropdown-list">
        <div class="quick-search-results"></div>
        <div class="quick-search-footer hidden-ext">
            <div class="dropdown-divider"></div>
            <a class="dropdown-item show-in-full-search" tabindex="0">${t("quick-search.show-in-full-search")}</a>
        </div>
    </div>
  </div>
  <input type="text" class="form-control form-control-sm search-string" placeholder="${t("quick-search.placeholder")}">
</div>`;

const INITIAL_DISPLAYED_NOTES = 15;
const LOAD_MORE_BATCH_SIZE = 10;


// TODO: Deduplicate with server.
interface QuickSearchResponse {
    searchResultNoteIds: string[];
    searchResults?: Array<{
        notePath: string;
        noteTitle: string;
        notePathTitle: string;
        highlightedNotePathTitle: string;
        contentSnippet?: string;
        highlightedContentSnippet?: string;
        attributeSnippet?: string;
        highlightedAttributeSnippet?: string;
        icon: string;
    }>;
    /** Plain search tokens the server highlighted; consumed by jump-to-match producers. */
    highlightedTokens?: string[];
    error: string;
}

export default class QuickSearchWidget extends BasicWidget {

    private dropdown!: bootstrap.Dropdown;
    private $searchString!: JQuery<HTMLElement>;
    private $dropdownMenu!: JQuery<HTMLElement>;
    private $searchResults!: JQuery<HTMLElement>;
    private $footer!: JQuery<HTMLElement>;

    // State for infinite scrolling
    private allSearchResults: Array<any> = [];
    private allSearchResultNoteIds: string[] = [];
    private currentDisplayedCount: number = 0;
    private isLoadingMore: boolean = false;

    // Attached to each result link so the opened note jumps to the first match; undefined when the
    // last search highlighted nothing, which keeps the links at a plain `#notePath`.
    private lastResultViewScope: ViewScope | undefined;

    doRender() {
        this.$widget = $(TPL);
        this.$searchString = this.$widget.find(".search-string");
        this.$dropdownMenu = this.$widget.find(".dropdown-menu");
        this.$searchResults = this.$dropdownMenu.find(".quick-search-results");
        this.$footer = this.$dropdownMenu.find(".quick-search-footer");

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            reference: this.$searchString[0],
            popperConfig: {
                strategy: "fixed",
                placement: "bottom"
            }
        });

        this.$widget.find(".input-group-prepend").on("shown.bs.dropdown", () => this.search());

        // Add scroll event listener for infinite scrolling
        this.$searchResults.on("scroll", () => {
            this.handleScroll();
        });

        const $showInFullSearchButton = this.$footer.find(".show-in-full-search");
        $showInFullSearchButton.on("click", () => this.showInFullSearch());
        shortcutService.bindElShortcut($showInFullSearchButton, "return", () => this.showInFullSearch());

        if (utils.isMobile()) {
            this.$searchString.keydown((e) => {
                // Skip processing if IME is composing to prevent interference
                // with text input in CJK languages
                // Note: jQuery wraps the native event, so we access originalEvent
                const originalEvent = e.originalEvent as KeyboardEvent;
                if (originalEvent && isIMEComposing(originalEvent)) {
                    return;
                }

                if (e.which === 13) {
                    if (this.$dropdownMenu.is(":visible")) {
                        this.search(); // just update already visible dropdown
                    } else {
                        this.dropdown.show();
                    }
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        }

        shortcutService.bindElShortcut(this.$searchString, "return", () => {
            if (this.$dropdownMenu.is(":visible")) {
                this.search(); // just update already visible dropdown
            } else {
                this.dropdown.show();
            }

            this.$searchString.focus();
        });

        // Bootstrap moves between the results but ignores key events on an input, so the step from
        // the search box into the list is bound here.
        this.$searchString.on("keydown", (e) => {
            const event = e.originalEvent as KeyboardEvent | undefined;

            if (!event || event.key !== "ArrowDown" || !this.isDropdownOpen()) {
                return;
            }

            if (isIMEComposing(event) || isAppShortcutChord(event) || event.shiftKey) {
                return;
            }

            const $firstResult = this.$searchResults.find(".dropdown-item:not(.disabled)").first();

            // Searching and no-results leave only a disabled item, and the caret keeps the key.
            if (!$firstResult.length) {
                return;
            }

            e.preventDefault();
            $firstResult.focus();
        });

        shortcutService.bindElShortcut(this.$searchString, "esc", () => {
            this.dropdown.hide();
        });

        return this.$widget;
    }

    async search() {
        const searchString = String(this.$searchString.val())?.trim();

        if (!searchString) {
            this.dropdown.hide();
            return;
        }

        // Reset state for new search
        this.allSearchResults = [];
        this.allSearchResultNoteIds = [];
        this.currentDisplayedCount = 0;
        this.isLoadingMore = false;

        this.$footer.addClass("hidden-ext");
        this.$searchResults.empty();
        this.$searchResults.append(`
            <span class="dropdown-item disabled">
                <span class="bx bx-loader bx-spin"></span>
                ${t("quick-search.searching")}
            </span>`);

        const { searchResultNoteIds, searchResults, highlightedTokens, error } = await server.get<QuickSearchResponse>(
            `quick-search?searchString=${encodeURIComponent(searchString)}`
        );

        this.lastResultViewScope = highlightedTokens?.length ? { searchTerms: highlightedTokens } : undefined;

        if (error) {
            const tooltip = new Tooltip(this.$searchString[0], {
                trigger: "manual",
                title: `Search error: ${error}`,
                placement: handleRightToLeftPlacement("right")
            });

            tooltip.show();

            setTimeout(() => tooltip.dispose(), 4000);
        }

        // Store all results for infinite scrolling
        this.allSearchResults = searchResults || [];
        this.allSearchResultNoteIds = searchResultNoteIds || [];

        this.$searchResults.empty();

        if (this.allSearchResults.length === 0 && this.allSearchResultNoteIds.length === 0) {
            this.$searchResults.append(`<span class="dropdown-item disabled">${t("quick-search.no-results")}</span>`);
            return;
        }

        // Display initial batch
        await this.displayMoreResults(INITIAL_DISPLAYED_NOTES);

        this.$footer.removeClass("hidden-ext");
        shortcutService.bindElShortcut(this.$searchResults.find(".dropdown-item:first"), "up", () => this.$searchString.focus());

        this.dropdown.update();
    }

    private async displayMoreResults(batchSize: number) {
        if (this.isLoadingMore) return;
        this.isLoadingMore = true;

        // Use highlighted search results if available, otherwise fall back to basic display
        if (this.allSearchResults.length > 0) {
            const startIndex = this.currentDisplayedCount;
            const endIndex = Math.min(startIndex + batchSize, this.allSearchResults.length);
            const resultsToDisplay = this.allSearchResults.slice(startIndex, endIndex);

            for (const result of resultsToDisplay) {
                if (!result.notePath) continue;

                // Set the href with .attr() rather than interpolating it into the HTML string, so
                // the query separators are not parsed as HTML entities.
                const $item = $(`<a class="dropdown-item" tabindex="0">`);
                $item.attr("href", calculateHash({ notePath: result.notePath, viewScope: this.lastResultViewScope }));

                // Build the display HTML with content snippet below the title
                let itemHtml = `<div class="quick-search-item">
                    <div class="quick-search-item-header">
                        <span class="quick-search-item-icon ${utils.escapeHtml(result.icon)}"></span>
                        <span class="search-result-title">${result.highlightedNotePathTitle}</span>
                    </div>`;

                // Add attribute snippet (tags/attributes) below the title if available
                if (result.highlightedAttributeSnippet) {
                    // Replace <br> with a blank space to join the atributes on the same single line
                    const snippet = (result.highlightedAttributeSnippet as string).replace(/<br\s?\/?>/g, " ");
                    itemHtml += `<div class="search-result-attributes">${snippet}</div>`;
                }

                // Add content snippet below the attributes if available
                if (result.highlightedContentSnippet) {
                    itemHtml += `<div class="search-result-content">${result.highlightedContentSnippet}</div>`;
                }

                itemHtml += `</div>`;

                $item.html(itemHtml);

                $item.on("click auxclick", () => {
                    this.dropdown.hide();
                });

                shortcutService.bindElShortcut($item, "return", () => {
                    this.dropdown.hide();
                    $item[0].click();
                });

                this.$searchResults.append($item);
            }

            this.currentDisplayedCount = endIndex;
        } else {
            // Fallback to original behavior if no highlighted results
            const startIndex = this.currentDisplayedCount;
            const endIndex = Math.min(startIndex + batchSize, this.allSearchResultNoteIds.length);
            const noteIdsToDisplay = this.allSearchResultNoteIds.slice(startIndex, endIndex);

            for (const note of await froca.getNotes(noteIdsToDisplay)) {
                const $link = await linkService.createLink(note.noteId, { showNotePath: true, showNoteIcon: true, viewScope: this.lastResultViewScope });
                $link.addClass("dropdown-item");
                $link.attr("tabIndex", "0");
                $link.on("click auxclick", (e) => {
                    this.dropdown.hide();

                    if (!e.target || (e.target as HTMLElement).nodeName !== "A") {
                        // click on the <a> is handled by the global goToLink handler,
                        // but we want the whole item clickable
                        $link.find("a")[0]?.dispatchEvent(new MouseEvent(e.type, e.originalEvent as MouseEventInit));
                    }
                });
                shortcutService.bindElShortcut($link, "return", () => {
                    this.dropdown.hide();
                    $link.find("a")[0]?.click();
                });

                this.$searchResults.append($link);
            }

            this.currentDisplayedCount = endIndex;
        }

        this.isLoadingMore = false;
    }

    private handleScroll() {
        if (this.isLoadingMore) return;

        const results = this.$searchResults[0];
        const scrollTop = results.scrollTop;
        const scrollHeight = results.scrollHeight;
        const clientHeight = results.clientHeight;

        // Trigger loading more when user scrolls near the bottom (within 50px)
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            const totalResults = this.allSearchResults.length > 0 ? this.allSearchResults.length : this.allSearchResultNoteIds.length;

            if (this.currentDisplayedCount < totalResults) {
                this.displayMoreResults(LOAD_MORE_BATCH_SIZE).then(() => this.dropdown.update());
            }
        }
    }

    /** Whether the results popup is open, which is what makes ArrowDown move focus into it. */
    private isDropdownOpen() {
        return this.$dropdownMenu.hasClass("show");
    }

    async showInFullSearch() {
        this.dropdown.hide();

        await appContext.triggerCommand("searchNotes", {
            searchString: String(this.$searchString.val())
        });
    }

    quickSearchEvent() {
        this.$searchString.focus();
    }
}
