import noteAutocompleteService, { CreateMode } from "../../services/note_autocomplete.js";
import TypeWidget from "./type_widget.js";
import appContext from "../../components/app_context.js";
import searchService from "../../services/search.js";
import { t } from "../../services/i18n.js";

const TPL = /*html*/`
<div class="note-detail-empty note-detail-printable">
    <style>
        .workspace-notes {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: space-evenly;
        }

        .workspace-notes .workspace-note {
            width: 130px;
            text-align: center;
            margin: 10px;
            border: 1px transparent solid;
        }

        .workspace-notes .workspace-note:hover {
            cursor: pointer;
            border: 1px solid var(--main-border-color);
        }

        .note-detail-empty-results .aa-dropdown-menu {
            max-height: 50vh;
            overflow: scroll;
            border: var(--bs-border-width) solid var(--bs-border-color);
            border-top: 0;
        }

        .empty-tab-search .note-autocomplete-input {
            border-bottom-left-radius: 0;
        }

        .empty-tab-search .input-clearer-button {
            border-bottom-right-radius: 0;
        }

        .workspace-icon {
            text-align: center;
            font-size: 500%;
        }
    </style>

    <div class="workspace-notes"></div>
    <div class="form-group empty-tab-search">
        <label>${t("empty.open_note_instruction")}</label>
        <div class="input-group mt-1">
            <input class="form-control note-autocomplete" placeholder="${t("empty.search_placeholder")}">
        </div>
    </div>
    <div class="note-detail-empty-results"></div>
</div>`;

export default class EmptyTypeWidget extends TypeWidget {

    private $autoComplete!: JQuery<HTMLElement>;
    private $results!: JQuery<HTMLElement>;
    private $workspaceNotes!: JQuery<HTMLElement>;

    static getType() {
        return "empty";
    }

    doRender() {
        // FIXME: this might be optimized - cleaned up after use since it's always used only for new tab

        this.$widget = $(TPL);
        this.$autoComplete = this.$widget.find(".note-autocomplete");
        this.$results = this.$widget.find(".note-detail-empty-results");

        noteAutocompleteService
            .initNoteAutocomplete(this.$autoComplete, {
                hideGoToSelectedNoteButton: true,
                createMode: CreateMode.CreateOnly,
                allowJumpToSearchNotes: true,
                container: this.$results[0]
            })
            .on("autocomplete:noteselected", function (event, suggestion, dataset) {
                if (!suggestion.notePath) {
                    return false;
                }

                const activeContext = appContext.tabManager.getActiveContext();
                if (activeContext) {
                    activeContext.setNote(suggestion.notePath);
                }
            });

        this.$workspaceNotes = this.$widget.find(".workspace-notes");

        noteAutocompleteService.showRecentNotes(this.$autoComplete);
        super.doRender();
    }

    async doRefresh() {
        const workspaceNotes = await searchService.searchForNotes("#workspace #!template");

        this.$workspaceNotes.empty();

        for (const workspaceNote of workspaceNotes) {
            this.$workspaceNotes.append(
                $('<div class="workspace-note">')
                    .append($("<div>").addClass(`${workspaceNote.getIcon()} workspace-icon`))
                    .append($("<div>").text(workspaceNote.title))
                    .attr("title", t("empty.enter_workspace", { title: workspaceNote.title }))
                    .on("click", () => this.triggerCommand("hoistNote", { noteId: workspaceNote.noteId }))
            );
        }

        this.$autoComplete.trigger("focus").trigger("select");
    }
}
