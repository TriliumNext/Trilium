import type { EventData } from "../../components/app_context.js";
import { closeActiveDialog, openDialog } from "../../services/dialog.js";
import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import BasicWidget from "../basic_widget.js";

const TPL = /*html*/`<div class="sort-child-notes-dialog modal mx-auto" tabindex="-1" role="dialog">
    <div class="modal-dialog modal-lg" style="max-width: 500px" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">${t("sort_child_notes.sort_children_by")}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${t("sort_child_notes.close")}"></button>
            </div>
            <form class="sort-child-notes-form">
                <div class="modal-body">
                    <h5>${t("sort_child_notes.sorting_criteria")}</h5>
                    <div class="form-check">
                        <label for="sort-by-title" class="form-check-label tn-radio">
                            <input id="sort-by-title" class="form-check-input" type="radio" name="sort-by" value="title" checked>
                            ${t("sort_child_notes.title")}
                        </label>
                    </div>
                    <div class="form-check">
                        <label for="sort-by-dateCreated" class="form-check-label tn-radio">
                            <input id="sort-by-dateCreated" class="form-check-input" type="radio" name="sort-by" value="dateCreated">
                            ${t("sort_child_notes.date_created")}
                        </label>
                    </div>
                    <div class="form-check">
                        <label for="sort-by-dateModified" class="form-check-label tn-radio">
                            <input id="sort-by-dateModified" class="form-check-input" type="radio" name="sort-by" value="dateModified">
                            ${t("sort_child_notes.date_modified")}
                        </label>
                    </div>
                    <br/>
                    <h5>${t("sort_child_notes.sorting_direction")}</h5>
                    <div class="form-check">
                        <label for="sort-direction-asc" class="form-check-label tn-radio">
                            <input id="sort-direction-asc" class="form-check-input" type="radio" name="sort-direction" value="asc" checked>
                            ${t("sort_child_notes.ascending")}
                        </label>
                    </div>
                    <div class="form-check">
                        <label for="sort-direction-desc" class="form-check-label tn-radio">
                            <input id="sort-direction-desc" class="form-check-input" type="radio" name="sort-direction" value="desc">
                            ${t("sort_child_notes.descending")}
                        </label>
                    </div>
                    <br />
                    <h5>${t("sort_child_notes.folders")}</h5>
                    <div class="form-check">
                        <label for="sort-folders-first" class="form-check-label tn-checkbox">
                            <input id="sort-folders-first" class="form-check-input" type="checkbox" name="sort-folders-first" value="1">
                            ${t("sort_child_notes.sort_folders_at_top")}
                        </label>
                    </div>
                    <br />
                    <h5>${t("sort_child_notes.natural_sort")}</h5>
                    <div class="form-check">
                        <label for="sort-natural" class="form-check-label tn-checkbox">
                            <input id="sort-natural" class="form-check-input" type="checkbox" name="sort-natural" value="1">
                            ${t("sort_child_notes.sort_with_respect_to_different_character_sorting")}
                        </label>
                    </div>
                    <br />
                    <div class="form-check">
                        <label>
                            ${t("sort_child_notes.natural_sort_language")}
                            <input class="form-control" name="sort-locale">
                            ${t("sort_child_notes.the_language_code_for_natural_sort")}
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="submit" class="btn btn-primary">${t("sort_child_notes.sort")}</button>
                </div>
            </form>
        </div>
    </div>
</div>`;

export default class SortChildNotesDialog extends BasicWidget {

    private parentNoteId?: string;
    private $form!: JQuery<HTMLElement>;

    doRender() {
        this.$widget = $(TPL);
        this.$form = this.$widget.find(".sort-child-notes-form");

        this.$form.on("submit", async (e) => {
            e.preventDefault();

            const sortBy = this.$form.find("input[name='sort-by']:checked").val();
            const sortDirection = this.$form.find("input[name='sort-direction']:checked").val();
            const foldersFirst = this.$form.find("input[name='sort-folders-first']").is(":checked");
            const sortNatural = this.$form.find("input[name='sort-natural']").is(":checked");
            const sortLocale = this.$form.find("input[name='sort-locale']").val();

            await server.put(`notes/${this.parentNoteId}/sort-children`, { sortBy, sortDirection, foldersFirst, sortNatural, sortLocale });

            closeActiveDialog();
        });
    }

    async sortChildNotesEvent({ node }: EventData<"sortChildNotes">) {
        this.parentNoteId = node.data.noteId;

        openDialog(this.$widget);

        this.$form.find("input:first").focus();
    }
}
