import { Dropdown } from "bootstrap";
import { NOTE_TYPES } from "../services/note_types.js";
import { t } from "../services/i18n.js";
import dialogService from "../services/dialog.js";
import mimeTypesService from "../services/mime_types.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import server from "../services/server.js";
import type { EventData } from "../components/app_context.js";
import type { NoteType } from "../entities/fnote.js";
import type FNote from "../entities/fnote.js";

const NOT_SELECTABLE_NOTE_TYPES = NOTE_TYPES.filter((nt) => nt.reserved || nt.static).map((nt) => nt.type);

const TPL = /*html*/`
<div class="dropdown note-type-widget">
    <style>
        .note-type-dropdown {
            max-height: 500px;
            overflow-y: auto;
            overflow-x: hidden;
        }
    </style>
    <button type="button" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false" class="btn btn-sm dropdown-toggle select-button note-type-button">
        <span class="note-type-desc"></span>
        <span class="caret"></span>
    </button>
    <div class="note-type-dropdown dropdown-menu dropdown-menu-left tn-dropdown-list"></div>
</div>
`;

export default class NoteTypeWidget extends NoteContextAwareWidget {

    private dropdown!: Dropdown;
    private $noteTypeDropdown!: JQuery<HTMLElement>;
    private $noteTypeButton!: JQuery<HTMLElement>;
    private $noteTypeDesc!: JQuery<HTMLElement>;

    doRender() {
        this.$widget = $(TPL);

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0]);

        this.$widget.on("show.bs.dropdown", () => this.renderDropdown());

        this.$noteTypeDropdown = this.$widget.find(".note-type-dropdown");
        this.$noteTypeButton = this.$widget.find(".note-type-button");
        this.$noteTypeDesc = this.$widget.find(".note-type-desc");

        this.$widget.on("click", ".dropdown-item", () => this.dropdown.toggle());
    }

    async refreshWithNote(note: FNote) {
        this.$noteTypeButton.prop("disabled", () => NOT_SELECTABLE_NOTE_TYPES.includes(note.type));

        this.$noteTypeDesc.text(await this.findTypeTitle(note.type, note.mime));

        this.dropdown.hide();
    }

    /** the actual body is rendered lazily on note-type button click */
    async renderDropdown() {
        this.$noteTypeDropdown.empty();

        if (!this.note) {
            return;
        }

        for (const noteType of NOTE_TYPES.filter((nt) => !nt.reserved && !nt.static)) {
            let $typeLink: JQuery<HTMLElement>;

            const $title = $("<span>").text(noteType.title);

            if (noteType.isNew) {
                $title.append($(`<span class="badge new-note-type-badge">`).text(t("note_types.new-feature")));
            }

            if (noteType.isBeta) {
                $title.append($(`<span class="badge">`).text(t("note_types.beta-feature")));
            }

            if (noteType.type !== "code") {
                $typeLink = $('<a class="dropdown-item">')
                    .attr("data-note-type", noteType.type)
                    .append('<span class="check">&check;</span> ')
                    .append($title)
                    .on("click", (e) => {
                        const type = $typeLink.attr("data-note-type");
                        const noteType = NOTE_TYPES.find((nt) => nt.type === type);

                        if (noteType) {
                            this.save(noteType.type, noteType.mime);
                        }
                    });
            } else {
                this.$noteTypeDropdown.append('<div class="dropdown-divider"></div>');
                $typeLink = $('<a class="dropdown-item disabled">').attr("data-note-type", noteType.type).append('<span class="check">&check;</span> ').append($("<strong>").text(noteType.title));
            }

            if (this.note.type === noteType.type) {
                $typeLink.addClass("selected");
            }

            this.$noteTypeDropdown.append($typeLink);
        }

        for (const mimeType of mimeTypesService.getMimeTypes()) {
            if (!mimeType.enabled) {
                continue;
            }

            const $mimeLink = $('<a class="dropdown-item">')
                .attr("data-mime-type", mimeType.mime)
                .append('<span class="check">&check;</span> ')
                .append($("<span>").text(mimeType.title))
                .on("click", (e) => {
                    const $link = $(e.target).closest(".dropdown-item");

                    this.save("code", $link.attr("data-mime-type") ?? "");
                });

            if (this.note.type === "code" && this.note.mime === mimeType.mime) {
                $mimeLink.addClass("selected");

                this.$noteTypeDesc.text(mimeType.title);
            }

            this.$noteTypeDropdown.append($mimeLink);
        }
    }

    async findTypeTitle(type: NoteType, mime: string) {
        if (type === "code") {
            const mimeTypes = mimeTypesService.getMimeTypes();
            const found = mimeTypes.find((mt) => mt.mime === mime);

            return found ? found.title : mime;
        } else {
            const noteType = NOTE_TYPES.find((nt) => nt.type === type);

            return noteType ? noteType.title : type;
        }
    }

    async save(type: NoteType, mime?: string) {
        if (type === this.note?.type && mime === this.note?.mime) {
            return;
        }

        if (type !== this.note?.type && !(await this.confirmChangeIfContent())) {
            return;
        }

        await server.put(`notes/${this.noteId}/type`, { type, mime });
    }

    async confirmChangeIfContent() {
        if (!this.note) {
            return;
        }

        const blob = await this.note.getBlob();

        if (!blob?.content || !blob.content.trim().length) {
            return true;
        }

        return await dialogService.confirm(t("note_types.confirm-change"));
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.isNoteReloaded(this.noteId)) {
            this.refresh();
        }
    }
}
