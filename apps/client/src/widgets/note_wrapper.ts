import FlexContainer from "./containers/flex_container.js";
import utils from "../services/utils.js";
import attributeService from "../services/attributes.js";
import type BasicWidget from "./basic_widget.js";
import type { EventData } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import type FNote from "../entities/fnote.js";
import { getLocaleById } from "../services/i18n.js";

export default class NoteWrapperWidget extends FlexContainer<BasicWidget> {

    private noteContext?: NoteContext;

    constructor() {
        super("column");

        this.css("flex-grow", "1").collapsible();
    }

    setNoteContextEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;

        this.refresh();
    }

    noteSwitchedAndActivatedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;

        this.refresh();
    }

    noteSwitchedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;

        this.refresh();
    }

    activeContextChangedEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;

        this.refresh();
    }

    refresh() {
        const isHiddenExt = this.isHiddenExt(); // preserve through class reset

        this.$widget.removeClass();

        this.toggleExt(!isHiddenExt);

        this.$widget.addClass("component note-split");

        const note = this.noteContext?.note;
        if (!note) {
            this.$widget.addClass("bgfx empty-note");
            return;
        }

        this.$widget.toggleClass("full-content-width", this.#isFullWidthNote(note));

        this.$widget.addClass(note.getCssClass());

        this.$widget.addClass(utils.getNoteTypeClass(note.type));
        this.$widget.addClass(utils.getMimeTypeClass(note.mime));
        this.$widget.addClass(`view-mode-${this.noteContext?.viewScope?.viewMode ?? "default"}`);
        this.$widget.addClass(note.getColorClass());
        this.$widget.toggleClass("options", note.isOptions());
        this.$widget.toggleClass("bgfx", this.#hasBackgroundEffects(note));
        this.$widget.toggleClass("protected", note.isProtected);

        const noteLanguage = note?.getLabelValue("language");
        const locale = getLocaleById(noteLanguage);
        this.$widget.toggleClass("rtl", !!locale?.rtl);
    }

    #isFullWidthNote(note: FNote) {
        if (["code", "image", "mermaid", "book", "render", "canvas", "webView", "mindMap"].includes(note.type)) {
            return true;
        }

        if (note.type === "file" && (note.mime === "application/pdf" || note.mime.startsWith("video/"))) {
            return true;
        }

        if (note.type === "search" && ![ "grid", "list" ].includes(note.getLabelValue("viewType") ?? "list")) {
            return true;
        }

        return !!note?.isLabelTruthy("fullContentWidth");
    }

    #hasBackgroundEffects(note: FNote): boolean {
        const MIME_TYPES_WITH_BACKGROUND_EFFECTS = [
            "application/pdf"
        ]

        if (note.isOptions()) {
            return true;
        }

        if (note.type === "file" && MIME_TYPES_WITH_BACKGROUND_EFFECTS.includes(note.mime)) {
            return true;
        }

        return false;
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        // listening on changes of note.type and CSS class
        const LABELS_CAUSING_REFRESH = ["cssClass", "language", "viewType", "color"];
        const noteId = this.noteContext?.noteId;
        if (
            loadResults.isNoteReloaded(noteId) ||
            loadResults.getAttributeRows().find((attr) => attr.type === "label" && LABELS_CAUSING_REFRESH.includes(attr.name ?? "") && attributeService.isAffecting(attr, this.noteContext?.note))
        ) {
            this.refresh();
        }
    }
}
