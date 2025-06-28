import NoteContextAwareWidget from "../note_context_aware_widget.js";
import attributeService from "../../services/attributes.js";
import { t } from "../../services/i18n.js";
import type FNote from "../../entities/fnote.js";
import type { EventData } from "../../components/app_context.js";

const TPL = /*html*/`
<div class="book-properties-widget">
    <style>
        .book-properties-widget {
            padding: 12px 12px 6px 12px;
            display: flex;
        }

        .book-properties-widget > * {
            margin-right: 15px;
        }
    </style>

    <div style="display: flex; align-items: baseline">
        <span style="white-space: nowrap">${t("book_properties.view_type")}:&nbsp; &nbsp;</span>

        <select class="view-type-select form-select form-select-sm">
            <option value="grid">${t("book_properties.grid")}</option>
            <option value="list">${t("book_properties.list")}</option>
            <option value="calendar">${t("book_properties.calendar")}</option>
            <option value="table">${t("book_properties.table")}</option>
        </select>
    </div>

    <button type="button"
            class="collapse-all-button btn btn-sm"
            title="${t("book_properties.collapse_all_notes")}">

        <span class="bx bx-layer-minus"></span>

        ${t("book_properties.collapse")}
    </button>

    <button type="button"
            class="expand-children-button btn btn-sm"
            title="${t("book_properties.expand_all_children")}">
        <span class="bx bx-move-vertical"></span>

        ${t("book_properties.expand")}
    </button>
</div>
`;

export default class BookPropertiesWidget extends NoteContextAwareWidget {

    private $viewTypeSelect!: JQuery<HTMLElement>;
    private $expandChildrenButton!: JQuery<HTMLElement>;
    private $collapseAllButton!: JQuery<HTMLElement>;

    get name() {
        return "bookProperties";
    }

    get toggleCommand() {
        return "toggleRibbonTabBookProperties";
    }

    isEnabled() {
        return this.note && this.note.type === "book";
    }

    getTitle() {
        return {
            show: this.isEnabled(),
            activate: true,
            title: t("book_properties.book_properties"),
            icon: "bx bx-book"
        };
    }

    doRender() {
        this.$widget = $(TPL);
        this.contentSized();

        this.$viewTypeSelect = this.$widget.find(".view-type-select");
        this.$viewTypeSelect.on("change", () => this.toggleViewType(String(this.$viewTypeSelect.val())));

        this.$expandChildrenButton = this.$widget.find(".expand-children-button");
        this.$expandChildrenButton.on("click", async () => {
            if (!this.noteId || !this.note) {
                return;
            }

            if (!this.note?.isLabelTruthy("expanded")) {
                await attributeService.addLabel(this.noteId, "expanded");
            }

            this.triggerCommand("refreshNoteList", { noteId: this.noteId });
        });

        this.$collapseAllButton = this.$widget.find(".collapse-all-button");
        this.$collapseAllButton.on("click", async () => {
            if (!this.noteId || !this.note) {
                return;
            }

            // owned is important - we shouldn't remove inherited expanded labels
            for (const expandedAttr of this.note.getOwnedLabels("expanded")) {
                await attributeService.removeAttributeById(this.noteId, expandedAttr.attributeId);
            }

            this.triggerCommand("refreshNoteList", { noteId: this.noteId });
        });
    }

    async refreshWithNote(note: FNote) {
        if (!this.note) {
            return;
        }

        const viewType = this.note.getLabelValue("viewType") || "grid";

        this.$viewTypeSelect.val(viewType);

        this.$expandChildrenButton.toggle(viewType === "list");
        this.$collapseAllButton.toggle(viewType === "list");
    }

    async toggleViewType(type: string) {
        if (!this.noteId) {
            return;
        }

        if (!["list", "grid", "calendar", "table"].includes(type)) {
            throw new Error(t("book_properties.invalid_view_type", { type }));
        }

        await attributeService.setLabel(this.noteId, "viewType", type);
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows().find((attr) => attr.noteId === this.noteId && attr.name === "viewType")) {
            this.refresh();
        }
    }
}
