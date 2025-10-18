import RightDropdownButtonWidget from "./right_dropdown_button.js";
import linkService from "../../services/link.js";
import utils from "../../services/utils.js";
import type FNote from "../../entities/fnote.js";

const DROPDOWN_TPL = `
<div class="bookmark-folder-widget">
    <style>
        .bookmark-folder-widget {
            min-width: 400px;
            max-height: 500px;
            padding: 7px 15px 0 15px;
            font-size: 1.2rem;
            overflow: auto;
        }

        .bookmark-folder-widget ul {
            padding: 0;
            list-style-type: none;
        }

        .bookmark-folder-widget .note-link {
            display: block;
            padding: 5px 10px 5px 5px;
        }

        .bookmark-folder-widget .note-link:hover {
            background-color: var(--accented-background-color);
            text-decoration: none;
        }

        .dropdown-menu .bookmark-folder-widget a:hover {
            text-decoration: none;
            background: transparent !important;
        }

        .bookmark-folder-widget li .note-link {
            padding-inline-start: 35px;
        }
    </style>

    <div class="parent-note"></div>

    <ul class="children-notes"></ul>
</div>`;

interface LinkOptions {
    showTooltip: boolean;
    showNoteIcon: boolean;
}

export default class BookmarkFolderWidget extends RightDropdownButtonWidget {
    private note: FNote;
    private $parentNote!: JQuery<HTMLElement>;
    private $childrenNotes!: JQuery<HTMLElement>;
    declare $dropdownContent: JQuery<HTMLElement>;

    constructor(note: FNote) {
        super(utils.escapeHtml(note.title), note.getIcon(), DROPDOWN_TPL);

        this.note = note;
    }

    doRender(): void {
        super.doRender();

        this.$parentNote = this.$dropdownContent.find(".parent-note");
        this.$childrenNotes = this.$dropdownContent.find(".children-notes");
    }

    async dropdownShown(): Promise<void> {
        this.$parentNote.empty();
        this.$childrenNotes.empty();

        const linkOptions: LinkOptions = {
            showTooltip: false,
            showNoteIcon: true
        };

        this.$parentNote.append((await linkService.createLink(this.note.noteId, linkOptions)).addClass("note-link"));

        for (const childNote of await this.note.getChildNotes()) {
            this.$childrenNotes.append($("<li>").append((await linkService.createLink(childNote.noteId, linkOptions)).addClass("note-link")));
        }
    }

    refreshIcon(): void {}
}
