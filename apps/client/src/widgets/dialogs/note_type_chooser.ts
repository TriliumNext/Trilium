import type { CommandNames } from "../../components/app_context.js";
import type { MenuCommandItem } from "../../menus/context_menu.js";
import { t } from "../../services/i18n.js";
import noteTypesService from "../../services/note_types.js";
import noteAutocompleteService from "../../services/note_autocomplete.js";
import BasicWidget from "../basic_widget.js";
import { Dropdown, Modal } from "bootstrap";

const TPL = /*html*/`
<div class="note-type-chooser-dialog modal mx-auto" tabindex="-1" role="dialog">
    <style>
        .note-type-chooser-dialog {
            /* note type chooser needs to be higher than other dialogs from which it is triggered, e.g. "add link"*/
            z-index: 1100 !important;
        }

        .note-type-chooser-dialog .input-group {
            margin-top: 15px;
            margin-bottom: 15px;
        }

        .note-type-chooser-dialog .note-type-dropdown {
            position: relative;
            font-size: large;
            padding: 20px;
            width: 100%;
            margin-top: 15px;
            max-height: 80vh;
            overflow: auto;
        }
    </style>
    <div class="modal-dialog" style="max-width: 500px;" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">${t("note_type_chooser.modal_title")}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${t("note_type_chooser.close")}"></button>
            </div>
            <div class="modal-body">
                ${t("note_type_chooser.change_path_prompt")}

                <div class="input-group">
                    <input class="choose-note-path form-control" placeholder="${t("note_type_chooser.search_placeholder")}">
                </div>

                ${t("note_type_chooser.modal_body")}

                <div class="dropdown" style="display: flex;">
                    <button class="note-type-dropdown-trigger" type="button" style="display: none;"
                            data-bs-toggle="dropdown" data-bs-display="static">
                    </button>

                    <div class="note-type-dropdown dropdown-menu static"></div>
                </div>
            </div>
        </div>
    </div>
</div>`;

export interface ChooseNoteTypeResponse {
    success: boolean;
    noteType?: string;
    templateNoteId?: string;
    notePath?: string;
}

type Callback = (data: ChooseNoteTypeResponse) => void;

export default class NoteTypeChooserDialog extends BasicWidget {
    private resolve: Callback | null;
    private dropdown!: Dropdown;
    private modal!: Modal;
    private $noteTypeDropdown!: JQuery<HTMLElement>;
    private $autoComplete!: JQuery<HTMLElement>;
    private $originalFocused: JQuery<HTMLElement> | null;
    private $originalDialog: JQuery<HTMLElement> | null;

    constructor() {
        super();

        this.resolve = null;
        this.$originalFocused = null; // element focused before the dialog was opened, so we can return to it afterward
        this.$originalDialog = null;
    }

    doRender() {
        this.$widget = $(TPL);
        this.modal = Modal.getOrCreateInstance(this.$widget[0]);
        
        this.$autoComplete = this.$widget.find(".choose-note-path");
        this.$noteTypeDropdown = this.$widget.find(".note-type-dropdown");
        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find(".note-type-dropdown-trigger")[0]);

        this.$widget.on("hidden.bs.modal", () => {
            if (this.resolve) {
                this.resolve({ success: false });
            }

            if (this.$originalFocused) {
                this.$originalFocused.trigger("focus");
                this.$originalFocused = null;
            }

            glob.activeDialog = this.$originalDialog;
        });

        this.$noteTypeDropdown.on("click", ".dropdown-item", (e) => this.doResolve(e));

        this.$noteTypeDropdown.on("focus", ".dropdown-item", (e) => {
            this.$noteTypeDropdown.find(".dropdown-item").each((i, el) => {
                $(el).toggleClass("active", el === e.target);
            });
        });

        this.$noteTypeDropdown.on("keydown", ".dropdown-item", (e) => {
            if (e.key === "Enter") {
                this.doResolve(e);
                e.preventDefault();
                return false;
            }
        });

        this.$noteTypeDropdown.parent().on("hide.bs.dropdown", (e) => {
            // prevent closing dropdown by clicking outside
            // TODO: Check if this actually works.
            //@ts-ignore
            if (e.clickEvent) {
                e.preventDefault();
            } else {
                this.modal.hide();
            }
        });
    }

    async refresh() {
        noteAutocompleteService
            .initNoteAutocomplete(this.$autoComplete, {
                allowCreatingNotes: false,
                hideGoToSelectedNoteButton: true,
                allowJumpToSearchNotes: false,
            })
    }

    async chooseNoteTypeEvent({ callback }: { callback: Callback }) {
        this.$originalFocused = $(":focus");

        await this.refresh();

        const noteTypes = await noteTypesService.getNoteTypeItems();

        this.$noteTypeDropdown.empty();

        for (const noteType of noteTypes) {
            if (noteType.title === "----") {
                this.$noteTypeDropdown.append($('<h6 class="dropdown-header">').append(t("note_type_chooser.templates")));
            } else {
                const commandItem = noteType as MenuCommandItem<CommandNames>;
                const listItem = $('<a class="dropdown-item" tabindex="0">')
                    .attr("data-note-type", commandItem.type || "")
                    .attr("data-template-note-id", commandItem.templateNoteId || "")
                    .append($("<span>").addClass(commandItem.uiIcon || ""))
                    .append(` ${noteType.title}`);

                if (commandItem.badges) {
                    for (let badge of commandItem.badges) {
                        listItem.append($(`<span class="badge">`)
                                .addClass(badge.className || "")
                                .text(badge.title));
                    }
                }

                this.$noteTypeDropdown.append(listItem);
            }
        }

        this.dropdown.show();

        this.$originalDialog = glob.activeDialog;
        glob.activeDialog = this.$widget;
        this.modal.show();

        this.$noteTypeDropdown.find(".dropdown-item:first").focus();

        this.resolve = callback;
    }

    doResolve(e: JQuery.KeyDownEvent | JQuery.ClickEvent) {
        const $item = $(e.target).closest(".dropdown-item");
        const noteType = $item.attr("data-note-type");
        const templateNoteId = $item.attr("data-template-note-id");
        const notePath = this.$autoComplete.getSelectedNotePath() || undefined;

        if (this.resolve) {
            this.resolve({
                success: true,
                noteType,
                templateNoteId,
                notePath
            });
        }
        this.resolve = null;

        this.modal.hide();
    }
}
