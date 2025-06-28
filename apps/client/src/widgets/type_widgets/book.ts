import TypeWidget from "./type_widget.js";
import { t } from "../../services/i18n.js";
import type FNote from "../../entities/fnote.js";
import type { EventData } from "../../components/app_context.js";

const TPL = /*html*/`
<div class="note-detail-book note-detail-printable">
    <style>
    .note-detail-book-auto-help {
        background-color: var(--accented-background-color);
        text-align: center;
        border-radius: 10px;
        padding: 5px;
        margin: 0 10px 10px 10px;
    }
    </style>

    <div class="note-detail-book-empty-help alert alert-warning" style="margin: 50px; padding: 20px;">
        ${t("book.no_children_help")}
    </div>
</div>`;

export default class BookTypeWidget extends TypeWidget {

    private $helpNoChildren!: JQuery<HTMLElement>;

    static getType() {
        return "book";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$helpNoChildren = this.$widget.find(".note-detail-book-empty-help");

        super.doRender();
    }

    async doRefresh(note: FNote) {
        this.$helpNoChildren.toggle(this.shouldDisplayNoChildrenWarning());
    }

    shouldDisplayNoChildrenWarning() {
        if (this.note?.hasChildren()) {
            return false;
        }

        switch (this.note?.getAttributeValue("label", "viewType")) {
            case "calendar":
            case "table":
                return false;
            default:
                return true;
        }
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows().find((attr) => attr.noteId === this.noteId && attr.name === "viewType")) {
            this.refresh();
        }
    }

}
