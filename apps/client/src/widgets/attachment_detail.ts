import { t } from "../services/i18n.js";
import utils from "../services/utils.js";
import AttachmentActionsWidget from "./buttons/attachments_actions.js";
import BasicWidget from "./basic_widget.js";
import options from "../services/options.js";
import imageService from "../services/image.js";
import linkService from "../services/link.js";
import contentRenderer from "../services/content_renderer.js";
import toastService from "../services/toast.js";
import type FAttachment from "../entities/fattachment.js";
import type { EventData } from "../components/app_context.js";
import mediaViewer from "../services/media_viewer.js";
import type { MediaItem } from "../services/media_viewer.js";

const TPL = /*html*/`
<div class="attachment-detail-widget">
    <style>
        .attachment-detail-widget {
            height: 100%;
        }

        .attachment-detail-wrapper {
            margin-bottom: 20px;
            display: flex;
            flex-direction: column;
        }

        .attachment-title-line {
            display: flex;
            align-items: baseline;
            gap: 1em;
        }

        .attachment-details {
            margin-left: 10px;
        }

        .attachment-content-wrapper {
            flex-grow: 1;
        }

        .attachment-content-wrapper .rendered-content {
            height: 100%;
        }

        .attachment-content-wrapper pre {
            padding: 10px;
            margin-top: 10px;
            margin-bottom: 10px;
        }

        .attachment-detail-wrapper.list-view .attachment-content-wrapper {
            max-height: 300px;
        }

        .attachment-detail-wrapper.full-detail {
            height: 100%;
        }

        .attachment-detail-wrapper.full-detail .attachment-content-wrapper {
            height: 100%;
        }

        .attachment-detail-wrapper.list-view .attachment-content-wrapper pre {
            max-height: 400px;
        }

        .attachment-content-wrapper img {
            margin: 10px;
            cursor: zoom-in;
            transition: opacity 0.2s;
        }
        
        .attachment-content-wrapper img:hover {
            opacity: 0.9;
        }

        .attachment-detail-wrapper.list-view .attachment-content-wrapper img, .attachment-detail-wrapper.list-view .attachment-content-wrapper video {
            max-height: 300px;
            max-width: 90%;
            object-fit: contain;
        }

        .attachment-detail-wrapper.full-detail .attachment-content-wrapper img {
            max-width: 90%;
            object-fit: contain;
        }
        
        .attachment-lightbox-hint {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        }
        
        .attachment-content-wrapper:hover .attachment-lightbox-hint {
            opacity: 1;
        }

        .attachment-detail-wrapper.scheduled-for-deletion .attachment-content-wrapper img {
            filter: contrast(10%);
        }
    </style>

    <div class="attachment-detail-wrapper">
        <div class="attachment-title-line">
            <div class="attachment-actions-container"></div>
            <h4 class="attachment-title"></h4>
            <div class="attachment-details"></div>
            <div style="flex: 1 1;"></div>
        </div>

        <div class="attachment-deletion-warning alert alert-info" style="margin-top: 15px;"></div>

        <div class="attachment-content-wrapper"></div>
    </div>
</div>`;

export default class AttachmentDetailWidget extends BasicWidget {
    attachment: FAttachment;
    attachmentActionsWidget: AttachmentActionsWidget;
    isFullDetail: boolean;
    $wrapper!: JQuery<HTMLElement>;

    constructor(attachment: FAttachment, isFullDetail: boolean) {
        super();

        this.contentSized();
        this.attachment = attachment;
        this.attachmentActionsWidget = new AttachmentActionsWidget(attachment, isFullDetail);
        this.isFullDetail = isFullDetail;
        this.child(this.attachmentActionsWidget);
    }

    doRender() {
        this.$widget = $(TPL);
        this.refresh();

        super.doRender();
    }

    async refresh() {
        this.$widget.find(".attachment-detail-wrapper").empty().append($(TPL).find(".attachment-detail-wrapper").html());
        this.$wrapper = this.$widget.find(".attachment-detail-wrapper");
        this.$wrapper.addClass(this.isFullDetail ? "full-detail" : "list-view");

        if (!this.isFullDetail) {
            const $link = await linkService.createLink(this.attachment.ownerId, {
                title: this.attachment.title,
                viewScope: {
                    viewMode: "attachments",
                    attachmentId: this.attachment.attachmentId
                }
            });
            $link.addClass("use-tn-links");

            this.$wrapper.find(".attachment-title").append($link);
        } else {
            this.$wrapper.find(".attachment-title").text(this.attachment.title);
        }

        const $deletionWarning = this.$wrapper.find(".attachment-deletion-warning");
        const { utcDateScheduledForErasureSince } = this.attachment;

        if (utcDateScheduledForErasureSince) {
            this.$wrapper.addClass("scheduled-for-deletion");

            const scheduledSinceTimestamp = utils.parseDate(utcDateScheduledForErasureSince)?.getTime();
            // use default value (30 days in seconds) from options_init as fallback, in case getInt returns null
            const intervalMs = options.getInt("eraseUnusedAttachmentsAfterSeconds") || 2592000 * 1000;
            const deletionTimestamp = scheduledSinceTimestamp + intervalMs;
            const willBeDeletedInMs = deletionTimestamp - Date.now();

            $deletionWarning.show();

            if (willBeDeletedInMs >= 60000) {
                $deletionWarning.text(t("attachment_detail_2.will_be_deleted_in", { time: utils.formatTimeInterval(willBeDeletedInMs) }));
            } else {
                $deletionWarning.text(t("attachment_detail_2.will_be_deleted_soon"));
            }

            $deletionWarning.append(t("attachment_detail_2.deletion_reason"));
        } else {
            this.$wrapper.removeClass("scheduled-for-deletion");
            $deletionWarning.hide();
        }

        this.$wrapper.find(".attachment-details").text(t("attachment_detail_2.role_and_size", { role: this.attachment.role, size: utils.formatSize(this.attachment.contentLength) }));
        this.$wrapper.find(".attachment-actions-container").append(this.attachmentActionsWidget.render());

        const { $renderedContent } = await contentRenderer.getRenderedContent(this.attachment, { imageHasZoom: this.isFullDetail });
        const $contentWrapper = this.$wrapper.find(".attachment-content-wrapper");
        $contentWrapper.append($renderedContent);
        
        // Add PhotoSwipe integration for image attachments
        if (this.attachment.role === 'image') {
            this.setupPhotoSwipeIntegration($contentWrapper);
        }
    }

    setupPhotoSwipeIntegration($contentWrapper: JQuery<HTMLElement>) {
        // Add lightbox hint
        const $hint = $('<div class="attachment-lightbox-hint">Click to view in lightbox</div>');
        $contentWrapper.css('position', 'relative').append($hint);
        
        // Find the image element
        const $img = $contentWrapper.find('img');
        if (!$img.length) return;
        
        // Setup click handler for lightbox with namespace for proper cleanup
        $img.off('click.photoswipe').on('click.photoswipe', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const item: MediaItem = {
                src: $img.attr('src') || '',
                alt: this.attachment.title,
                title: this.attachment.title,
                noteId: this.attachment.ownerId,
                element: $img[0] as HTMLElement
            };
            
            // Try to get actual dimensions
            const imgElement = $img[0] as HTMLImageElement;
            if (imgElement.naturalWidth && imgElement.naturalHeight) {
                item.width = imgElement.naturalWidth;
                item.height = imgElement.naturalHeight;
            }
            
            mediaViewer.openSingle(item, {
                bgOpacity: 0.95,
                showHideOpacity: true,
                pinchToClose: true,
                closeOnScroll: false,
                closeOnVerticalDrag: true,
                wheelToZoom: true,
                getThumbBoundsFn: () => {
                    // Get position for zoom animation
                    const rect = imgElement.getBoundingClientRect();
                    return {
                        x: rect.left,
                        y: rect.top,
                        w: rect.width
                    };
                }
            }, {
                onOpen: () => {
                    console.log('Attachment image opened in lightbox');
                },
                onClose: () => {
                    // Restore focus to the image
                    $img.focus();
                }
            });
        });
        
        // Add keyboard support
        $img.attr('tabindex', '0')
            .attr('role', 'button')
            .attr('aria-label', 'Click to view in lightbox');
        
        // Use namespaced event for proper cleanup
        $img.off('keydown.photoswipe').on('keydown.photoswipe', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $img.trigger('click');
            }
        });
    }

    async copyAttachmentLinkToClipboard() {
        if (this.attachment.role === "image") {
            imageService.copyImageReferenceToClipboard(this.$wrapper.find(".attachment-content-wrapper"));
        } else if (this.attachment.role === "file") {
            const $link = await linkService.createLink(this.attachment.ownerId, {
                referenceLink: true,
                viewScope: {
                    viewMode: "attachments",
                    attachmentId: this.attachment.attachmentId
                }
            });

            utils.copyHtmlToClipboard($link[0].outerHTML);

            toastService.showMessage(t("attachment_detail_2.link_copied"));
        } else {
            throw new Error(t("attachment_detail_2.unrecognized_role", { role: this.attachment.role }));
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        const attachmentRow = loadResults.getAttachmentRows().find((att) => att.attachmentId === this.attachment.attachmentId);

        if (attachmentRow) {
            if (attachmentRow.isDeleted) {
                this.toggleInt(false);
            } else {
                this.refresh();
            }
        }
    }
    
    cleanup() {
        // Remove all event handlers before cleanup
        const $contentWrapper = this.$wrapper?.find('.attachment-content-wrapper');
        if ($contentWrapper?.length) {
            const $img = $contentWrapper.find('img');
            if ($img.length) {
                // Remove namespaced event handlers
                $img.off('.photoswipe');
            }
        }
        
        super.cleanup();
    }
}
