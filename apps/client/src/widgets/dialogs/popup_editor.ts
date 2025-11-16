import type { EventNames, EventData } from "../../components/app_context.js";
import NoteContext from "../../components/note_context.js";
import { openDialog } from "../../services/dialog.js";
import BasicWidget, { ReactWrappedWidget } from "../basic_widget.js";
import Container from "../containers/container.js";

const TPL = /*html*/`\
<div class="popup-editor-dialog modal fade mx-auto" tabindex="-1" role="dialog">
    <style>
        /** Reduce the z-index of modals so that ckeditor popups are properly shown on top of it. */
        body.popup-editor-open > .modal-backdrop { z-index: 998; }
        body.popup-editor-open .popup-editor-dialog { z-index: 999; }
        body.popup-editor-open .ck-clipboard-drop-target-line { z-index: 1000; }

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

    <div class="quick-edit-dialog-wrapper">
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
</div>
`;

export default class PopupEditorDialog extends Container<BasicWidget> {

    private noteContext: NoteContext;
    private $modalHeader!: JQuery<HTMLElement>;
    private $modalBody!: JQuery<HTMLElement>;
    private $wrapper!: JQuery<HTMLDivElement>;

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
        this.$wrapper = $newWidget.find(".quick-edit-dialog-wrapper");

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

        const colorClass = this.noteContext.note?.getColorClass();
        const wrapperElement = this.$wrapper.get(0)!;

        if (colorClass) {
            wrapperElement.className = "quick-edit-dialog-wrapper " + colorClass;
        } else {
            wrapperElement.className = "quick-edit-dialog-wrapper";
        }

        const customHue = getComputedStyle(wrapperElement).getPropertyValue("--custom-color-hue");
        if (customHue) {
            /* Apply the tinted-dialog class only if the custom color CSS class specifies a hue */
            wrapperElement.classList.add("tinted-quick-edit-dialog");
        }

        const activeEl = document.activeElement;
        if (activeEl && "blur" in activeEl) {
            (activeEl as HTMLElement).blur();
        }

        $dialog.on("shown.bs.modal", async () => {
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
            document.body.classList.add("popup-editor-open");

        } else {
            $bodyItems.hide();
            this.$modalHeader.children().hide();
            document.body.classList.remove("popup-editor-open");
        }
    }

    handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>): Promise<unknown[] | unknown> | null {
        // Avoid events related to the current tab interfere with our popup.
        if (["noteSwitched", "noteSwitchedAndActivated", "exportAsPdf", "printActiveNote"].includes(name)) {
            return Promise.resolve();
        }

        // Avoid not showing recent notes when creating a new empty tab.
        if ("noteContext" in data && data.noteContext.ntxId !== "_popup-editor") {
            return Promise.resolve();
        }

        return super.handleEventInChildren(name, data);
    }

}
