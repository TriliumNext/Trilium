import type { CKTextEditor, ModelElement } from "@triliumnext/ckeditor5";

import appContext from "../../../components/app_context";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import { openAnnotationOverlay } from "../../../services/image_annotation";
import link, { ViewScope } from "../../../services/link";
import utils from "../../../services/utils";

export async function loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>, boxSize?: string) {
    const note = await froca.getNote(noteId);
    if (!note) return;

    // The box size is supplied explicitly by the editing-view downcast; for the other
    // callers (read-only rendering, script API refresh) fall back to reading it from the DOM.
    const effectiveBoxSize = boxSize ?? $el.closest('section.include-note').attr('data-box-size');
    const isExpandable = effectiveBoxSize === 'expandable';

    // The editing-view downcast passes the `.include-note-wrapper` element itself as $el, whereas the
    // read-only and refresh paths pass the outer `section.include-note`. Build the content in a
    // detached wrapper either way (so the old content stays visible during the async render — no
    // flicker), then swap it in; when $el is already the wrapper we move the built children straight
    // into it instead of nesting a redundant second `.include-note-wrapper`.
    const isWrapper = $el.hasClass('include-note-wrapper');
    const $wrapper = $('<div class="include-note-wrapper">');
    const $link = await link.createLink(note.noteId, {
        showTooltip: false,
        showNoteIcon: true
    });

    if (isExpandable) {
        // Create expandable structure with toggle
        const $titleRow = $('<div class="include-note-title-row">');
        const $toggle = $('<button class="include-note-toggle bx bx-chevron-right" aria-expanded="false">');
        const $title = $('<h4 class="include-note-title">').append($link);

        $titleRow.append($toggle, $title);
        $wrapper.append($titleRow);

        const { $renderedContent, type } = await content_renderer.getRenderedContent(note, { interactive: true });
        const $content = $(`<div class="include-note-content type-${type}" style="display: none;">`).append($renderedContent);
        $wrapper.append($content);

        // Add toggle functionality
        $toggle.on('click', (e) => {
            e.stopPropagation();
            const isExpanded = $toggle.attr('aria-expanded') === 'true';
            $toggle.attr('aria-expanded', String(!isExpanded));
            $toggle.toggleClass('expanded');
            $content.slideToggle(200);
        });
    } else {
        // Standard display
        $wrapper.append($('<h4 class="include-note-title">').append($link));

        const { $renderedContent, type } = await content_renderer.getRenderedContent(note, { interactive: true });
        $wrapper.append($(`<div class="include-note-content type-${type}">`).append($renderedContent));
    }

    // Unmount any interactive widgets from a previous render of this include (e.g. on a box-size
    // change or refreshIncludedNote) before $el.empty() discards their DOM — otherwise their
    // standalone Preact roots (collections, web views) would leak.
    content_renderer.disposeInteractiveContent($el);
    $el.empty().append(isWrapper ? $wrapper.children() : $wrapper);
}

export function refreshIncludedNote(container: HTMLDivElement, noteId: string) {
    const includedNotes = container.querySelectorAll(`section[data-note-id="${noteId}"]`);
    for (const includedNote of includedNotes) {
        loadIncludedNote(noteId, $(includedNote as HTMLElement));
    }
}

export function setupImageOpening(container: HTMLDivElement, singleClickOpens: boolean) {
    const $container = $(container);
    $container.on("dblclick", "img", (e) => openImageInCurrentTab($(e.target)));
    $container.on("click", "img", (e) => {
        e.stopPropagation();
        const isLeftClick = e.which === 1;
        const isMiddleClick = e.which === 2;
        const ctrlKey = utils.isCtrlKey(e);
        const activate = (isLeftClick && ctrlKey && e.shiftKey) || (isMiddleClick && e.shiftKey);

        if ((isLeftClick && ctrlKey) || isMiddleClick) {
            openImageInNewTab($(e.target), activate);
        } else if (isLeftClick && singleClickOpens) {
            openImageInCurrentTab($(e.target));
        }
    });
}

async function openImageInCurrentTab($img: JQuery<HTMLElement>) {
    const parsedImage  = await parseFromImage($img);

    if (parsedImage) {
        appContext.tabManager.getActiveContext()?.setNote(parsedImage.noteId, { viewScope: parsedImage.viewScope });
    } else {
        window.open($img.prop("src"), "_blank");
    }
}

async function openImageInNewTab($img: JQuery<HTMLElement>, activate: boolean = false) {
    const parsedImage = await parseFromImage($img);

    if (parsedImage) {
        appContext.tabManager.openTabWithNoteWithHoisting(parsedImage.noteId, { activate, viewScope: parsedImage.viewScope });
    } else {
        window.open($img.prop("src"), "_blank");
    }
}

async function parseFromImage($img: JQuery<HTMLElement>): Promise<{ noteId: string; viewScope: ViewScope } | null> {
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
        if (!attachment) return null;

        return {
            noteId: attachment.ownerId,
            viewScope: {
                viewMode: "attachments",
                attachmentId: attachmentId
            }
        };
    }

    return null;
}

import { ATTACHMENT_API_RE, IMAGE_API_RE } from "./image_url_patterns.js";
export { ATTACHMENT_API_RE, IMAGE_API_RE };

async function resolveEmbeddedImageEntity(src: string) {
    const imageMatch = src.match(IMAGE_API_RE);
    if (imageMatch) return await froca.getNote(imageMatch[1]);

    const attachmentMatch = src.match(ATTACHMENT_API_RE);
    if (attachmentMatch) return await froca.getAttachment(attachmentMatch[1]) ?? null;

    return null;
}

interface AnnotateImageEventEmitter {
    on(event: "annotateImage:open", handler: (evt: unknown, data: { src: string; element: ModelElement }) => void): void;
}

export function setupImageAnnotationButton(editor: CKTextEditor) {
    
    (editor as unknown as AnnotateImageEventEmitter).on("annotateImage:open", async (_evt, data) => {
        const { src, element: capturedElement } = data;
        const normalizedSrc = src.startsWith("http") || src.startsWith("/") ? src : `/${src}`;
        const entity = await resolveEmbeddedImageEntity(normalizedSrc);
        if (!entity) return;

        openAnnotationOverlay({
            entity,
            imageUrl: normalizedSrc,
            onSaved: (newUrl) => {
                const resolvedNewUrl = newUrl.startsWith("/") ? newUrl : `/${newUrl}`;
                try {
                    editor.model.change((writer) => {
                        writer.setAttribute("src", resolvedNewUrl, capturedElement);
                    });
                } catch {

                }
            }
        });
    });
}
