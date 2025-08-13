import { type EventData } from "../../components/app_context.js";
import type FNote from "../../entities/fnote.js";
import type { NoteType } from "../../entities/fnote.js";
import { t } from "../../services/i18n.js";
import type { ViewTypeOptions } from "../../services/note_list_renderer.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";

const TPL = /*html*/`
<button class="open-contextual-help-button" title="${t("help-button.title")}">
    <span class="bx bx-help-circle"></span>
</button>
`;

export const byNoteType: Record<Exclude<NoteType, "book">, string | null> = {
    canvas: null,
    code: null,
    contentWidget: null,
    doc: null,
    file: null,
    image: null,
    launcher: null,
    mermaid: null,
    mindMap: null,
    noteMap: null,
    relationMap: null,
    render: null,
    search: null,
    text: null,
    webView: null,
    aiChat: null
};

export const byBookType: Record<ViewTypeOptions, string | null> = {
    list: "mULW0Q3VojwY",
    grid: "8QqnMzx393bx",
    calendar: "xWbu3jpNWapp",
    table: "2FvYrpmOXm29",
    geoMap: "81SGnPGMk7Xc",
    board: "CtBQqbwXDx1w"
};

export default class ContextualHelpButton extends NoteContextAwareWidget {

    isEnabled() {
        if (!super.isEnabled()) {
            return false;
        }

        return !!ContextualHelpButton.#getUrlToOpen(this.note);
    }

    doRender() {
        this.$widget = $(TPL);
    }

    static #getUrlToOpen(note: FNote | null | undefined) {
        if (note && note.type !== "book" && byNoteType[note.type]) {
            return byNoteType[note.type];
        } else if (note?.hasLabel("calendarRoot")) {
            return "l0tKav7yLHGF";
        } else if (note?.hasLabel("textSnippet")) {
            return "pwc194wlRzcH";
        } else if (note && note.type === "book") {
            return byBookType[note.getAttributeValue("label", "viewType") as ViewTypeOptions ?? ""]
        }
    }

    async refreshWithNote(note: FNote | null | undefined): Promise<void> {
        this.$widget.attr("data-in-app-help", ContextualHelpButton.#getUrlToOpen(this.note) ?? "");
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.note?.type === "book" && loadResults.getAttributeRows().find((attr) => attr.noteId === this.noteId && attr.name === "viewType")) {
            this.refresh();
        }
    }

}
