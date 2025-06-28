import linkService from "../../services/link.js";
import contentRenderer from "../../services/content_renderer.js";
import froca from "../../services/froca.js";
import attributeRenderer from "../../services/attribute_renderer.js";
import treeService from "../../services/tree.js";
import utils from "../../services/utils.js";
import type FNote from "../../entities/fnote.js";
import ViewMode, { type ViewModeArgs } from "./view_mode.js";
import type { ViewTypeOptions } from "../../services/note_list_renderer.js";

const TPL = /*html*/`
<div class="note-list">
    <style>
    .note-list {
        overflow: hidden;
        position: relative;
        height: 100%;
    }

    .note-list.grid-view .note-list-container {
        display: flex;
        flex-wrap: wrap;
    }

    .note-list.grid-view .note-book-card {
        flex-basis: 300px;
        border: 1px solid transparent;
    }

    .note-list.grid-view .note-expander {
        display: none;
    }

    .note-list.grid-view .note-book-card {
        max-height: 300px;
    }

    .note-list.grid-view .note-book-card img {
        max-height: 220px;
        object-fit: contain;
    }

    .note-list.grid-view .note-book-card:hover {
        cursor: pointer;
        border: 1px solid var(--main-border-color);
        background: var(--more-accented-background-color);
    }

    .note-book-card {
        border-radius: 10px;
        background-color: var(--accented-background-color);
        padding: 10px 15px 15px 8px;
        margin: 5px 5px 5px 5px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        flex-grow: 1;
    }

    .note-book-card:not(.expanded) .note-book-content {
        display: none !important;
        padding: 10px
    }

    .note-book-card.expanded .note-book-content {
        display: block;
        min-height: 0;
        height: 100%;
        padding-top: 10px;
    }

    .note-book-content .rendered-content {
        height: 100%;
    }

    .note-book-header {
        border-bottom: 1px solid var(--main-border-color);
        margin-bottom: 0;
        padding-bottom: .5rem;
        word-break: break-all;
    }

    /* not-expanded title is limited to one line only */
    .note-book-card:not(.expanded) .note-book-header {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .note-book-header .rendered-note-attributes {
        font-size: medium;
    }

    .note-book-header .rendered-note-attributes:before {
        content: "\\00a0\\00a0";
    }

    .note-book-header .note-icon {
        font-size: 100%;
        display: inline-block;
        padding-right: 7px;
        position: relative;
    }

    .note-book-card .note-book-card {
        border: 1px solid var(--main-border-color);
    }

    .note-book-content.type-image, .note-book-content.type-file, .note-book-content.type-protectedSession {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 10px;
    }

    .note-book-content.type-image img, .note-book-content.type-canvas svg {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    }

    .note-book-card.type-image .note-book-content img,
    .note-book-card.type-text .note-book-content img,
    .note-book-card.type-canvas .note-book-content img {
        max-width: 100%;
        max-height: 100%;
    }

    .note-book-header {
        flex-grow: 0;
    }

    .note-list-wrapper {
        height: 100%;
        overflow: auto;
    }

    .note-expander {
        font-size: x-large;
        position: relative;
        top: 3px;
        cursor: pointer;
    }

    .note-list-pager {
        text-align: center;
    }
    </style>

    <div class="note-list-wrapper">
        <div class="note-list-pager"></div>

        <div class="note-list-container use-tn-links"></div>

        <div class="note-list-pager"></div>
    </div>
</div>`;

class ListOrGridView extends ViewMode<{}> {
    private $noteList: JQuery<HTMLElement>;

    private noteIds: string[];
    private page?: number;
    private pageSize?: number;
    private showNotePath?: boolean;
    private highlightRegex?: RegExp | null;

    /*
     * We're using noteIds so that it's not necessary to load all notes at once when paging
     */
    constructor(viewType: ViewTypeOptions, args: ViewModeArgs) {
        super(args, viewType);
        this.$noteList = $(TPL);

        const includedNoteIds = this.getIncludedNoteIds();

        this.noteIds = args.noteIds.filter((noteId) => !includedNoteIds.has(noteId) && noteId !== "_hidden");

        if (this.noteIds.length === 0) {
            return;
        }

        args.$parent.append(this.$noteList);

        this.page = 1;
        this.pageSize = parseInt(args.parentNote.getLabelValue("pageSize") || "");

        if (!this.pageSize || this.pageSize < 1) {
            this.pageSize = 20;
        }

        this.$noteList.addClass(`${this.viewType}-view`);

        this.showNotePath = args.showNotePath;
    }

    /** @returns {Set<string>} list of noteIds included (images, included notes) in the parent note and which
     *                        don't have to be shown in the note list. */
    getIncludedNoteIds() {
        const includedLinks = this.parentNote ? this.parentNote.getRelations().filter((rel) => rel.name === "imageLink" || rel.name === "includeNoteLink") : [];

        return new Set(includedLinks.map((rel) => rel.value));
    }

    async renderList() {
        if (this.noteIds.length === 0 || !this.page || !this.pageSize) {
            this.$noteList.hide();
            return;
        }

        const highlightedTokens = this.parentNote.highlightedTokens || [];
        if (highlightedTokens.length > 0) {
            const regex = highlightedTokens.map((token) => utils.escapeRegExp(token)).join("|");

            this.highlightRegex = new RegExp(regex, "gi");
        } else {
            this.highlightRegex = null;
        }

        this.$noteList.show();

        const $container = this.$noteList.find(".note-list-container").empty();

        const startIdx = (this.page - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;

        const pageNoteIds = this.noteIds.slice(startIdx, Math.min(endIdx, this.noteIds.length));
        const pageNotes = await froca.getNotes(pageNoteIds);

        for (const note of pageNotes) {
            const $card = await this.renderNote(note, this.parentNote.isLabelTruthy("expanded"));

            $container.append($card);
        }

        this.renderPager();

        return this.$noteList;
    }

    renderPager() {
        const $pager = this.$noteList.find(".note-list-pager").empty();
        if (!this.page || !this.pageSize) {
            return;
        }

        const pageCount = Math.ceil(this.noteIds.length / this.pageSize);

        $pager.toggle(pageCount > 1);

        let lastPrinted;

        for (let i = 1; i <= pageCount; i++) {
            if (pageCount < 20 || i <= 5 || pageCount - i <= 5 || Math.abs(this.page - i) <= 2) {
                lastPrinted = true;

                const startIndex = (i - 1) * this.pageSize + 1;
                const endIndex = Math.min(this.noteIds.length, i * this.pageSize);

                $pager.append(
                    i === this.page
                        ? $("<span>").text(i).css("text-decoration", "underline").css("font-weight", "bold")
                        : $('<a href="javascript:">')
                            .text(i)
                            .attr("title", `Page of ${startIndex} - ${endIndex}`)
                            .on("click", () => {
                                this.page = i;
                                this.renderList();
                            }),
                    " &nbsp; "
                );
            } else if (lastPrinted) {
                $pager.append("... &nbsp; ");

                lastPrinted = false;
            }
        }

        // no need to distinguish "note" vs "notes" since in case of one result, there's no paging at all
        $pager.append(`<span class="note-list-pager-total-count">(${this.noteIds.length} notes)</span>`);
    }

    async renderNote(note: FNote, expand: boolean = false) {
        const $expander = $('<span class="note-expander bx bx-chevron-right"></span>');

        const { $renderedAttributes } = await attributeRenderer.renderNormalAttributes(note);
        const notePath =
            this.parentNote.type === "search"
                ? note.noteId // for search note parent, we want to display a non-search path
                : `${this.parentNote.noteId}/${note.noteId}`;

        const $card = $('<div class="note-book-card">')
            .attr("data-note-id", note.noteId)
            .append(
                $('<h5 class="note-book-header">')
                    .append($expander)
                    .append($('<span class="note-icon">').addClass(note.getIcon()))
                    .append(
                        this.viewType === "grid"
                            ? $('<span class="note-book-title">').text(await treeService.getNoteTitle(note.noteId, this.parentNote.noteId))
                            : (await linkService.createLink(notePath, { showTooltip: false, showNotePath: this.showNotePath })).addClass("note-book-title")
                    )
                    .append($renderedAttributes)
            );

        if (this.viewType === "grid") {
            $card
                .addClass("block-link")
                .attr("data-href", `#${notePath}`)
                .on("click", (e) => linkService.goToLink(e));
        }

        $expander.on("click", () => this.toggleContent($card, note, !$card.hasClass("expanded")));

        if (this.highlightRegex) {
            const Mark = new (await import("mark.js")).default($card.find(".note-book-title")[0]);
            Mark.markRegExp(this.highlightRegex, {
                element: "span",
                className: "ck-find-result"
            });
        }

        await this.toggleContent($card, note, expand);

        return $card;
    }

    async toggleContent($card: JQuery<HTMLElement>, note: FNote, expand: boolean) {
        if (this.viewType === "list" && ((expand && $card.hasClass("expanded")) || (!expand && !$card.hasClass("expanded")))) {
            return;
        }

        const $expander = $card.find("> .note-book-header .note-expander");

        if (expand || this.viewType === "grid") {
            $card.addClass("expanded");
            $expander.addClass("bx-chevron-down").removeClass("bx-chevron-right");
        } else {
            $card.removeClass("expanded");
            $expander.addClass("bx-chevron-right").removeClass("bx-chevron-down");
        }

        if ((expand || this.viewType === "grid") && $card.find(".note-book-content").length === 0) {
            $card.append(await this.renderNoteContent(note));
        }
    }

    async renderNoteContent(note: FNote) {
        const $content = $('<div class="note-book-content">');

        try {
            const { $renderedContent, type } = await contentRenderer.getRenderedContent(note, {
                trim: this.viewType === "grid" // for grid only short content is needed
            });

            if (this.highlightRegex) {
                const Mark = new (await import("mark.js")).default($renderedContent[0]);
                Mark.markRegExp(this.highlightRegex, {
                    element: "span",
                    className: "ck-find-result"
                });
            }

            $content.append($renderedContent);
            $content.addClass(`type-${type}`);
        } catch (e) {
            console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
            console.error(e);

            $content.append("rendering error");
        }

        if (this.viewType === "list") {
            const imageLinks = note.getRelations("imageLink");

            const childNotes = (await note.getChildNotes()).filter((childNote) => !imageLinks.find((rel) => rel.value === childNote.noteId));

            for (const childNote of childNotes) {
                $content.append(await this.renderNote(childNote));
            }
        }

        return $content;
    }
}

export default ListOrGridView;
