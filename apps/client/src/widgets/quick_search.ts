import BasicWidget from "./basic_widget.js";
import server from "../services/server.js";
import linkService from "../services/link.js";
import froca from "../services/froca.js";
import utils from "../services/utils.js";
import appContext from "../components/app_context.js";
import shortcutService, { isIMEComposing } from "../services/shortcuts.js";
import { t } from "../services/i18n.js";
import { Dropdown, Tooltip } from "bootstrap";

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
        overflow-y: auto;
        overflow-x: hidden;
        text-overflow: ellipsis;
        box-shadow: -30px 50px 93px -50px black;
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
        left: 0;
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
    
    .quick-search .dropdown-item.show-in-full-search::after {
        display: none;
    }
    
    .quick-search-item.dropdown-item:hover {
        background-color: #f8f9fa;
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

    /* Search result highlighting */
    .quick-search .search-result-title b,
    .quick-search .search-result-content b,
    .quick-search .search-result-attributes b {
        color: var(--admonition-warning-accent-color);
        text-decoration: underline;
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
    <div class="dropdown-menu tn-dropdown-list"></div>
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
    error: string;
}

export default class QuickSearchWidget extends BasicWidget {

    private dropdown!: bootstrap.Dropdown;
    private $searchString!: JQuery<HTMLElement>;
    private $dropdownMenu!: JQuery<HTMLElement>;
    
    // State for infinite scrolling
    private allSearchResults: Array<any> = [];
    private allSearchResultNoteIds: string[] = [];
    private currentDisplayedCount: number = 0;
    private isLoadingMore: boolean = false;

    doRender() {
        this.$widget = $(TPL);
        this.$searchString = this.$widget.find(".search-string");
        this.$dropdownMenu = this.$widget.find(".dropdown-menu");

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            reference: this.$searchString[0],
            popperConfig: {
                strategy: "fixed",
                placement: "bottom"
            }
        });

        this.$widget.find(".input-group-prepend").on("shown.bs.dropdown", () => this.search());
        
        // Add scroll event listener for infinite scrolling
        this.$dropdownMenu.on("scroll", () => {
            this.handleScroll();
        });

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

        shortcutService.bindElShortcut(this.$searchString, "down", () => {
            this.$dropdownMenu.find(".dropdown-item:not(.disabled):first").focus();
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

        this.$dropdownMenu.empty();
        this.$dropdownMenu.append(`
            <span class="dropdown-item disabled">
                <span class="bx bx-loader bx-spin"></span>
                ${t("quick-search.searching")}
            </span>`);

        const { searchResultNoteIds, searchResults, error } = await server.get<QuickSearchResponse>(`quick-search/${encodeURIComponent(searchString)}`);

        if (error) {
            let tooltip = new Tooltip(this.$searchString[0], {
                trigger: "manual",
                title: `Search error: ${error}`,
                placement: "right"
            });

            tooltip.show();

            setTimeout(() => tooltip.dispose(), 4000);
        }

        // Store all results for infinite scrolling
        this.allSearchResults = searchResults || [];
        this.allSearchResultNoteIds = searchResultNoteIds || [];

        this.$dropdownMenu.empty();

        if (this.allSearchResults.length === 0 && this.allSearchResultNoteIds.length === 0) {
            this.$dropdownMenu.append(`<span class="dropdown-item disabled">${t("quick-search.no-results")}</span>`);
            return;
        }

        // Display initial batch
        await this.displayMoreResults(INITIAL_DISPLAYED_NOTES);
        this.addShowInFullSearchButton();

        this.dropdown.update();
    }

    private async displayMoreResults(batchSize: number) {
        if (this.isLoadingMore) return;
        this.isLoadingMore = true;

        // Remove the "Show in full search" button temporarily
        this.$dropdownMenu.find('.show-in-full-search').remove();
        this.$dropdownMenu.find('.dropdown-divider').remove();

        // Use highlighted search results if available, otherwise fall back to basic display
        if (this.allSearchResults.length > 0) {
            const startIndex = this.currentDisplayedCount;
            const endIndex = Math.min(startIndex + batchSize, this.allSearchResults.length);
            const resultsToDisplay = this.allSearchResults.slice(startIndex, endIndex);

            for (const result of resultsToDisplay) {
                const noteId = result.notePath.split("/").pop();
                if (!noteId) continue;

                const $item = $('<a class="dropdown-item" tabindex="0" href="javascript:">');
                
                // Build the display HTML with content snippet below the title
                let itemHtml = `<div class="quick-search-item">
                    <div class="quick-search-item-header">
                        <span class="quick-search-item-icon ${result.icon}"></span>
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
                
                $item.on("click", (e) => {
                    this.dropdown.hide();
                    e.preventDefault();
                    
                    const activeContext = appContext.tabManager.getActiveContext();
                    if (activeContext) {
                        activeContext.setNote(noteId);
                    }
                });
                
                shortcutService.bindElShortcut($item, "return", () => {
                    this.dropdown.hide();

                    const activeContext = appContext.tabManager.getActiveContext();
                    if (activeContext) {
                        activeContext.setNote(noteId);
                    }
                });

                this.$dropdownMenu.append($item);
            }

            this.currentDisplayedCount = endIndex;
        } else {
            // Fallback to original behavior if no highlighted results
            const startIndex = this.currentDisplayedCount;
            const endIndex = Math.min(startIndex + batchSize, this.allSearchResultNoteIds.length);
            const noteIdsToDisplay = this.allSearchResultNoteIds.slice(startIndex, endIndex);

            for (const note of await froca.getNotes(noteIdsToDisplay)) {
                const $link = await linkService.createLink(note.noteId, { showNotePath: true, showNoteIcon: true });
                $link.addClass("dropdown-item");
                $link.attr("tabIndex", "0");
                $link.on("click", (e) => {
                    this.dropdown.hide();

                    if (!e.target || e.target.nodeName !== "A") {
                        // click on the link is handled by link handling, but we want the whole item clickable
                        const activeContext = appContext.tabManager.getActiveContext();
                        if (activeContext) {
                            activeContext.setNote(note.noteId);
                        }
                    }
                });
                shortcutService.bindElShortcut($link, "return", () => {
                    this.dropdown.hide();

                    const activeContext = appContext.tabManager.getActiveContext();
                    if (activeContext) {
                        activeContext.setNote(note.noteId);
                    }
                });

                this.$dropdownMenu.append($link);
            }

            this.currentDisplayedCount = endIndex;
        }

        this.isLoadingMore = false;
    }

    private handleScroll() {
        if (this.isLoadingMore) return;

        const dropdown = this.$dropdownMenu[0];
        const scrollTop = dropdown.scrollTop;
        const scrollHeight = dropdown.scrollHeight;
        const clientHeight = dropdown.clientHeight;

        // Trigger loading more when user scrolls near the bottom (within 50px)
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            const totalResults = this.allSearchResults.length > 0 ? this.allSearchResults.length : this.allSearchResultNoteIds.length;
            
            if (this.currentDisplayedCount < totalResults) {
                this.displayMoreResults(LOAD_MORE_BATCH_SIZE).then(() => {
                    this.addShowInFullSearchButton();
                });
            }
        }
    }

    private addShowInFullSearchButton() {
        // Remove existing button if it exists
        this.$dropdownMenu.find('.show-in-full-search').remove();
        this.$dropdownMenu.find('.dropdown-divider').remove();

        const $showInFullButton = $('<a class="dropdown-item show-in-full-search" tabindex="0">').text(t("quick-search.show-in-full-search"));

        this.$dropdownMenu.append($(`<div class="dropdown-divider">`));
        this.$dropdownMenu.append($showInFullButton);

        $showInFullButton.on("click", () => this.showInFullSearch());

        shortcutService.bindElShortcut($showInFullButton, "return", () => this.showInFullSearch());

        shortcutService.bindElShortcut(this.$dropdownMenu.find(".dropdown-item:first"), "up", () => this.$searchString.focus());

        this.dropdown.update();
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
