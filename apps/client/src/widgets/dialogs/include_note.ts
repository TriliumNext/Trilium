import { t } from "../../services/i18n.js";
import treeService from "../../services/tree.js";
import noteAutocompleteService from "../../services/note_autocomplete.js";
import froca from "../../services/froca.js";
import BasicWidget from "../basic_widget.js";
import { Modal } from "bootstrap";
import type { EventData } from "../../components/app_context.js";
import type EditableTextTypeWidget from "../type_widgets/editable_text.js";
import { openDialog } from "../../services/dialog.js";

const TPL = /*html*/`
<div class="include-note-dialog modal mx-auto" tabindex="-1" role="dialog">
    <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">${t("include_note.dialog_title")}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${t("include_note.close")}"></button>
            </div>
            <form class="include-note-form">
                <div class="modal-body">
                    <div class="form-group">
                        <label for="include-note-autocomplete">${t("include_note.label_note")}</label>
                        <div class="input-group">
                            <input class="include-note-autocomplete form-control" placeholder="${t("include_note.placeholder_search")}">
                        </div>
                    </div>

                    ${t("include_note.box_size_prompt")}

                    <div class="form-check">
                        <label class="form-check-label tn-radio">
                            <input class="form-check-input" type="radio" name="include-note-box-size" value="small">
                            ${t("include_note.box_size_small")}
                        </label>
                    </div>
                    <div class="form-check">
                        <label class="form-check-label tn-radio">
                            <input class="form-check-input" type="radio" name="include-note-box-size" value="medium" checked>
                            ${t("include_note.box_size_medium")}
                        </label>
                    </div>
                    <div class="form-check">
                        <label class="form-check-label tn-radio">
                            <input class="form-check-input" type="radio" name="include-note-box-size" value="full">
                            ${t("include_note.box_size_full")}
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn btn-primary">${t("include_note.button_include")}</button>
                </div>
            </form>
        </div>
    </div>
</div>`;

export default class IncludeNoteDialog extends BasicWidget {

    private modal!: bootstrap.Modal;
    private $form!: JQuery<HTMLElement>;
    private $autoComplete!: JQuery<HTMLElement>;
    private textTypeWidget?: EditableTextTypeWidget;

    doRender() {
        this.$widget = $(TPL);
        this.modal = Modal.getOrCreateInstance(this.$widget[0]);
        this.$form = this.$widget.find(".include-note-form");
        this.$autoComplete = this.$widget.find(".include-note-autocomplete");
        this.$form.on("submit", () => {
            const notePath = this.$autoComplete.getSelectedNotePath();

            if (notePath) {
                this.modal.hide();
                this.includeNote(notePath);
            } else {
                logError("No noteId to include.");
            }

            return false;
        });
    }

    async showIncludeNoteDialogEvent({ textTypeWidget }: EventData<"showIncludeDialog">) {
        this.textTypeWidget = textTypeWidget;
        await this.refresh();
        openDialog(this.$widget);

        this.$autoComplete.trigger("focus").trigger("select"); // to be able to quickly remove entered text
    }

    async refresh() {
        this.$autoComplete.val("");
        noteAutocompleteService.initNoteAutocomplete(this.$autoComplete, {
            hideGoToSelectedNoteButton: true,
            allowCreatingNotes: true
        });
        noteAutocompleteService.showRecentNotes(this.$autoComplete);
    }

    async includeNote(notePath: string) {
        const noteId = treeService.getNoteIdFromUrl(notePath);
        if (!noteId) {
            return;
        }
        const note = await froca.getNote(noteId);
        const boxSize = $("input[name='include-note-box-size']:checked").val() as string;

        if (["image", "canvas", "mermaid"].includes(note?.type ?? "")) {
            // there's no benefit to use insert note functionlity for images,
            // so we'll just add an IMG tag
            this.textTypeWidget?.addImage(noteId);
        } else {
            this.textTypeWidget?.addIncludeNote(noteId, boxSize);
        }
    }
}
