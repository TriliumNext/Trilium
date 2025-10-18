import TypeWidget from "./type_widget.js";
import AttachmentDetailWidget from "../attachment_detail.js";
import linkService from "../../services/link.js";
import utils from "../../services/utils.js";
import { t } from "../../services/i18n.js";
import type { EventData } from "../../components/app_context.js";

const TPL = /*html*/`
<div class="attachment-list note-detail-printable">
    <style>
        .attachment-list {
            padding-inline-start: 15px;
            padding-inline-end: 15px;
        }

        .attachment-list .links-wrapper {
            font-size: larger;
            margin-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
        }
    </style>

    <div class="links-wrapper"></div>

    <div class="attachment-list-wrapper"></div>
</div>`;

export default class AttachmentListTypeWidget extends TypeWidget {
    $list!: JQuery<HTMLElement>;
    $linksWrapper!: JQuery<HTMLElement>;
    renderedAttachmentIds!: Set<string>;

    static getType() {
        return "attachmentList";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$list = this.$widget.find(".attachment-list-wrapper");
        this.$linksWrapper = this.$widget.find(".links-wrapper");

        super.doRender();
    }

    async doRefresh(note: Parameters<TypeWidget["doRefresh"]>[0]) {
        const $helpButton = $(`
            <button class="attachment-help-button icon-action bx bx-help-circle"
                     type="button" data-help-page="attachments.html"
                     title="${t("attachment_list.open_help_page")}">
            </button>
        `);
        utils.initHelpButtons($helpButton);

        const noteLink = await linkService.createLink(this.noteId); // do separately to avoid race condition between empty() and .append()
        noteLink.addClass("use-tn-links");

        const $uploadButton = $(`
            <button class="btn btn-sm">
                <span class="bx bx-folder-open"></span>
                ${t("attachment_list.upload_attachments")}
            </button>
        `);

        $uploadButton.on("click", () => {
            if (this.noteId) {
                this.triggerCommand("showUploadAttachmentsDialog", { noteId: this.noteId });
            }
        })

        this.$linksWrapper.empty().append(
            $("<div>").append(t("attachment_list.owning_note"), noteLink),
            $(`<div class="attachment-actions-toolbar">`).append($uploadButton, $helpButton)
        );

        this.$list.empty();
        this.children = [];
        this.renderedAttachmentIds = new Set();

        const attachments = await note.getAttachments();

        if (attachments.length === 0) {
            this.$list.html('<div class="alert alert-info">' + t("attachment_list.no_attachments") + "</div>");
            return;
        }

        for (const attachment of attachments) {
            const attachmentDetailWidget = new AttachmentDetailWidget(attachment, false);

            this.child(attachmentDetailWidget);

            this.renderedAttachmentIds.add(attachment.attachmentId);

            this.$list.append(attachmentDetailWidget.render());
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        // updates and deletions are handled by the detail, for new attachments the whole list has to be refreshed
        const attachmentsAdded = loadResults.getAttachmentRows().some((att) => att.attachmentId && !this.renderedAttachmentIds.has(att.attachmentId));

        if (attachmentsAdded) {
            this.refresh();
        }
    }
}
