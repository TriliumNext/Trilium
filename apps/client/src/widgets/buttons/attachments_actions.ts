import { t } from "../../services/i18n.js";
import BasicWidget from "../basic_widget.js";
import server from "../../services/server.js";
import dialogService from "../../services/dialog.js";
import toastService from "../../services/toast.js";
import ws from "../../services/ws.js";
import appContext from "../../components/app_context.js";
import openService from "../../services/open.js";
import utils from "../../services/utils.js";
import { Dropdown } from "bootstrap";
import type FAttachment from "../../entities/fattachment.js";
import type AttachmentDetailWidget from "../attachment_detail.js";
import type { NoteRow } from "@triliumnext/commons";

const TPL = /*html*/`
<div class="dropdown attachment-actions">
    <style>
    .attachment-actions {
        width: 35px;
        height: 35px;
    }

    .attachment-actions .dropdown-menu {
        width: 20em;
    }

    .attachment-actions .dropdown-item .bx {
        position: relative;
        top: 3px;
        font-size: 120%;
        margin-inline-end: 5px;
    }

    .attachment-actions .dropdown-item[disabled], .attachment-actions .dropdown-item[disabled]:hover {
        color: var(--muted-text-color) !important;
        background-color: transparent !important;
        pointer-events: none; /* makes it unclickable */
    }
    </style>

    <button type="button" data-bs-toggle="dropdown" aria-haspopup="true"
        aria-expanded="false" class="icon-action icon-action-always-border bx bx-dots-vertical-rounded"
        style="position: relative; top: 3px;"></button>

    <div class="dropdown-menu dropdown-menu-right">

        <li data-trigger-command="openAttachment" class="dropdown-item"
            title="${t("attachments_actions.open_externally_title")}"><span class="bx bx-file-find"></span> ${t("attachments_actions.open_externally")}</li>

        <li data-trigger-command="openAttachmentCustom" class="dropdown-item"
            title="${t("attachments_actions.open_custom_title")}"><span class="bx bx-customize"></span> ${t("attachments_actions.open_custom")}</li>

        <li data-trigger-command="downloadAttachment" class="dropdown-item">
            <span class="bx bx-download"></span> ${t("attachments_actions.download")}</li>

        <li data-trigger-command="copyAttachmentLinkToClipboard" class="dropdown-item"><span class="bx bx-link">
            </span> ${t("attachments_actions.copy_link_to_clipboard")}</li>


        <div class="dropdown-divider"></div>


        <li data-trigger-command="uploadNewAttachmentRevision" class="dropdown-item"><span class="bx bx-upload">
            </span> ${t("attachments_actions.upload_new_revision")}</li>

        <li data-trigger-command="renameAttachment" class="dropdown-item">
            <span class="bx bx-rename"></span> ${t("attachments_actions.rename_attachment")}</li>

        <li data-trigger-command="deleteAttachment" class="dropdown-item">
            <span class="bx bx-trash destructive-action-icon"></span> ${t("attachments_actions.delete_attachment")}</li>


        <div class="dropdown-divider"></div>


        <li data-trigger-command="convertAttachmentIntoNote" class="dropdown-item"><span class="bx bx-note">
            </span> ${t("attachments_actions.convert_attachment_into_note")}</li>

    </div>

    <input type="file" class="attachment-upload-new-revision-input" style="display: none">
</div>`;

// TODO: Deduplicate
interface AttachmentResponse {
    note: NoteRow;
}

export default class AttachmentActionsWidget extends BasicWidget {
    $uploadNewRevisionInput!: JQuery<HTMLInputElement>;
    attachment: FAttachment;
    isFullDetail: boolean;
    dropdown!: Dropdown;

    constructor(attachment: FAttachment, isFullDetail: boolean) {
        super();

        this.attachment = attachment;
        this.isFullDetail = isFullDetail;
    }

    get attachmentId() {
        return this.attachment.attachmentId;
    }

    doRender() {
        this.$widget = $(TPL);
        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0]);
        this.$widget.on("click", ".dropdown-item", () => this.dropdown.toggle());

        this.$uploadNewRevisionInput = this.$widget.find(".attachment-upload-new-revision-input");
        this.$uploadNewRevisionInput.on("change", async () => {
            const fileToUpload = this.$uploadNewRevisionInput[0].files?.item(0); // copy to allow reset below
            this.$uploadNewRevisionInput.val("");
            if (fileToUpload) {
                const result = await server.upload(`attachments/${this.attachmentId}/file`, fileToUpload);
                if (result.uploaded) {
                    toastService.showMessage(t("attachments_actions.upload_success"));
                } else {
                    toastService.showError(t("attachments_actions.upload_failed"));
                }
            }
        });

        const isElectron = utils.isElectron();
        if (!this.isFullDetail) {
            const $openAttachmentButton = this.$widget.find("[data-trigger-command='openAttachment']");
            $openAttachmentButton.addClass("disabled").append($('<span class="bx bx-info-circle disabled-tooltip" />').attr("title", t("attachments_actions.open_externally_detail_page")));
            if (isElectron) {
                const $openAttachmentCustomButton = this.$widget.find("[data-trigger-command='openAttachmentCustom']");
                $openAttachmentCustomButton.addClass("disabled").append($('<span class="bx bx-info-circle disabled-tooltip" />').attr("title", t("attachments_actions.open_externally_detail_page")));
            }
        }
        if (!isElectron) {
            const $openAttachmentCustomButton = this.$widget.find("[data-trigger-command='openAttachmentCustom']");
            $openAttachmentCustomButton.addClass("disabled").append($('<span class="bx bx-info-circle disabled-tooltip" />').attr("title", t("attachments_actions.open_custom_client_only")));
        }
    }

    async openAttachmentCommand() {
        await openService.openAttachmentExternally(this.attachmentId, this.attachment.mime);
    }

    async openAttachmentCustomCommand() {
        await openService.openAttachmentCustom(this.attachmentId, this.attachment.mime);
    }

    async downloadAttachmentCommand() {
        await openService.downloadAttachment(this.attachmentId);
    }

    async uploadNewAttachmentRevisionCommand() {
        this.$uploadNewRevisionInput.trigger("click");
    }

    async copyAttachmentLinkToClipboardCommand() {
        if (this.parent && "copyAttachmentLinkToClipboard" in this.parent) {
            (this.parent as AttachmentDetailWidget).copyAttachmentLinkToClipboard();
        }
    }

    async deleteAttachmentCommand() {
        if (!(await dialogService.confirm(t("attachments_actions.delete_confirm", { title: this.attachment.title })))) {
            return;
        }

        await server.remove(`attachments/${this.attachmentId}`);
        toastService.showMessage(t("attachments_actions.delete_success", { title: this.attachment.title }));
    }

    async convertAttachmentIntoNoteCommand() {
        if (!(await dialogService.confirm(t("attachments_actions.convert_confirm", { title: this.attachment.title })))) {
            return;
        }

        const { note: newNote } = await server.post<AttachmentResponse>(`attachments/${this.attachmentId}/convert-to-note`);
        toastService.showMessage(t("attachments_actions.convert_success", { title: this.attachment.title }));
        await ws.waitForMaxKnownEntityChangeId();
        await appContext.tabManager.getActiveContext()?.setNote(newNote.noteId);
    }

    async renameAttachmentCommand() {
        const attachmentTitle = await dialogService.prompt({
            title: t("attachments_actions.rename_attachment"),
            message: t("attachments_actions.enter_new_name"),
            defaultValue: this.attachment.title
        });

        if (!attachmentTitle?.trim()) {
            return;
        }

        await server.put(`attachments/${this.attachmentId}/rename`, { title: attachmentTitle });
    }
}
