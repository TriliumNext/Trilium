import TypeWidget from "./type_widget.js";
import appContext, { type EventData } from "../../components/app_context.js";
import froca from "../../services/froca.js";
import linkService, { type ViewScope } from "../../services/link.js";
import contentRenderer from "../../services/content_renderer.js";
import utils from "../../services/utils.js";
import options from "../../services/options.js";
import attributes from "../../services/attributes.js";

export default class AbstractTextTypeWidget extends TypeWidget {
    doRender() {
        super.doRender();
        this.refreshCodeBlockOptions();
    }

    setupImageOpening(singleClickOpens: boolean) {
        this.$widget.on("dblclick", "img", (e) => this.openImageInCurrentTab($(e.target)));

        this.$widget.on("click", "img", (e) => {
            e.stopPropagation();
            const isLeftClick = e.which === 1;
            const isMiddleClick = e.which === 2;
            const ctrlKey = utils.isCtrlKey(e);
            const activate = (isLeftClick && ctrlKey && e.shiftKey) || (isMiddleClick && e.shiftKey);

            if ((isLeftClick && ctrlKey) || isMiddleClick) {
                this.openImageInNewTab($(e.target), activate);
            } else if (isLeftClick && singleClickOpens) {
                this.openImageInCurrentTab($(e.target));
            }
        });
    }

    async openImageInCurrentTab($img: JQuery<HTMLElement>) {
        const parsedImage  = await this.parseFromImage($img);

        if (parsedImage) {
            appContext.tabManager.getActiveContext()?.setNote(parsedImage.noteId, { viewScope: parsedImage.viewScope });
        } else {
            window.open($img.prop("src"), "_blank");
        }
    }

    async openImageInNewTab($img: JQuery<HTMLElement>, activate: boolean = false) {
        const parsedImage = await this.parseFromImage($img);

        if (parsedImage?.noteId) {
            appContext.tabManager.openTabWithNoteWithHoisting(parsedImage.noteId, { activate, viewScope: parsedImage.viewScope });
        } else {
            window.open($img.prop("src"), "_blank");
        }
    }

    async parseFromImage($img: JQuery<HTMLElement>): Promise<{ noteId?: string, viewScope: ViewScope } | null> {
        const imgSrc = $img.prop("src");

        const imageNoteMatch = imgSrc.match(/\/api\/images\/([A-Za-z0-9_]+)\//);
        if (imageNoteMatch) {
            return {
                noteId: imageNoteMatch[1],
                viewScope: {}
            };
        }

        const attachmentMatch = imgSrc.match(/\/api\/attachments\/([A-Za-z0-9_]+)\/image\//);
        if (attachmentMatch) {
            const attachmentId = attachmentMatch[1];
            const attachment = await froca.getAttachment(attachmentId);

            return {
                noteId: attachment?.ownerId,
                viewScope: {
                    viewMode: "attachments",
                    attachmentId: attachmentId
                }
            };
        }

        return null;
    }

    async loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>) {
        const note = await froca.getNote(noteId);

        if (note) {
            const $wrapper = $('<div class="include-note-wrapper">');

            const $link = await linkService.createLink(note.noteId, {
                showTooltip: false
            });

            $wrapper.empty().append($('<h4 class="include-note-title">').append($link));

            const { $renderedContent, type } = await contentRenderer.getRenderedContent(note);

            $wrapper.append($(`<div class="include-note-content type-${type}">`).append($renderedContent));

            $el.empty().append($wrapper);
        }
    }

    async loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string | null = null) {
        await linkService.loadReferenceLinkTitle($el, href);
    }

    refreshIncludedNote($container: JQuery<HTMLElement>, noteId: string) {
        if ($container) {
            $container.find(`section[data-note-id="${noteId}"]`).each((_, el) => {
                this.loadIncludedNote(noteId, $(el));
            });
        }
    }

    refreshCodeBlockOptions() {
        const wordWrap = options.is("codeBlockWordWrap");
        this.$widget.toggleClass("word-wrap", wordWrap);
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.isOptionReloaded("codeBlockWordWrap")) {
            this.refreshCodeBlockOptions();
        }

        if (loadResults.getAttributeRows().find((attr) =>
            attr.type === "label" &&
            attr.name === "language" &&
            attributes.isAffecting(attr, this.note)))
        {
            await this.onLanguageChanged();
        }
    }

    async onLanguageChanged() { }

}
