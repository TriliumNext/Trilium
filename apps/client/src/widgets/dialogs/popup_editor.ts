import type { EventNames, EventData } from "../../components/app_context.js";
import NoteContext from "../../components/note_context.js";
import { openDialog } from "../../services/dialog.js";
import BasicWidget, { ReactWrappedWidget } from "../basic_widget.js";
import Container from "../containers/container.js";

const TPL = /*html*/`\
<div class="popup-editor-dialog modal fade mx-auto" tabindex="-1" role="dialog">
    <style>
        body.desktop .modal.popup-editor-dialog .modal-dialog {
            max-width: 75vw;
        }

        .modal.popup-editor-dialog .modal-header .modal-title {
            font-size: 1.1em;
        }

        .modal.popup-editor-dialog .modal-body {
            padding: 0;
            height: 75vh;
            overflow: auto;
        }

        .modal.popup-editor-dialog .note-detail-editable-text {
            padding: 0 1em;
        }

        .modal.popup-editor-dialog .title-row,
        .modal.popup-editor-dialog .modal-title,
        .modal.popup-editor-dialog .note-icon-widget {
            height: 32px;
        }

        .modal.popup-editor-dialog .note-icon-widget {
            width: 32px;
            margin: 0;
            padding: 0;
        }

        .modal.popup-editor-dialog .note-icon-widget button.note-icon,
        .modal.popup-editor-dialog .note-title-widget input.note-title {
            font-size: 1em;
        }

        .modal.popup-editor-dialog .classic-toolbar-widget {
            position: sticky;
            top: 0;
            inset-inline-start: 0;
            inset-inline-end: 0;
            background: var(--modal-background-color);
            z-index: 998;
        }

        .modal.popup-editor-dialog .note-detail-file {
            padding: 0;
        }
    </style>

    <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal-title">
                    <!-- This is where the first child will be injected -->
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>

            <div class="modal-body">
                <!-- This is where all but the first child will be injected. -->
            </div>
        </div>
    </div>
</div>
`;

export default class PopupEditorDialog extends Container<BasicWidget> {

    private noteContext: NoteContext;
    private $modalHeader!: JQuery<HTMLElement>;
    private $modalBody!: JQuery<HTMLElement>;

    constructor() {
        super();
        this.noteContext = new NoteContext("_popup-editor");
    }

    doRender() {
        // This will populate this.$widget with the content of the children.
        super.doRender();

        // Now we wrap it in the modal.
        const $newWidget = $(TPL);
        this.$modalHeader = $newWidget.find(".modal-title");
        this.$modalBody = $newWidget.find(".modal-body");

        const children = this.$widget.children();
        this.$modalHeader.append(children[0]);
        this.$modalBody.append(children.slice(1));
        this.$widget = $newWidget;
        this.setVisibility(false);
    }

    async openInPopupEvent({ noteIdOrPath }: EventData<"openInPopup">) {
        const $dialog = await openDialog(this.$widget, false, {
            focus: false
        });

        await this.noteContext.setNote(noteIdOrPath, {
            viewScope: {
                readOnlyTemporarilyDisabled: true
            }
        });

        const activeEl = document.activeElement;
        if (activeEl && "blur" in activeEl) {
            (activeEl as HTMLElement).blur();
        }

        $dialog.on("shown.bs.modal", async () => {
            // Reduce the z-index of modals so that ckeditor popups are properly shown on top of it.
            // The backdrop instance is not shared so it's OK to make a one-off modification.
            $("body > .modal-backdrop").css("z-index", "998");
            $dialog.css("z-index", "999");

            await this.handleEventInChildren("activeContextChanged", { noteContext: this.noteContext });
            this.setVisibility(true);
            await this.handleEventInChildren("focusOnDetail", { ntxId: this.noteContext.ntxId });
        });
        $dialog.on("hidden.bs.modal", () => {
            const $typeWidgetEl = $dialog.find(".note-detail-printable");
            if ($typeWidgetEl.length) {
                const typeWidget = glob.getComponentByEl($typeWidgetEl[0]) as ReactWrappedWidget;
                typeWidget.cleanup();
            }

            this.setVisibility(false);
        });
    }

    setVisibility(visible: boolean) {
        const $bodyItems = this.$modalBody.find("> div");
        if (visible) {
            $bodyItems.fadeIn();
            this.$modalHeader.children().show();
        } else {
            $bodyItems.hide();
            this.$modalHeader.children().hide();
        }
    }

    handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>): Promise<unknown[] | unknown> | null {
        // Avoid events related to the current tab interfere with our popup.
        if (["noteSwitched", "noteSwitchedAndActivated", "exportAsPdf", "printActiveNote"].includes(name)) {
            return Promise.resolve();
        }

        return super.handleEventInChildren(name, data);
    }

}
