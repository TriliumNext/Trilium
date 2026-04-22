import appContext from "../../../components/app_context";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link, { ViewScope } from "../../../services/link";
import utils from "../../../services/utils";

export async function loadIncludedNote(noteId: string, $el: JQuery<HTMLElement>) {
    const note = await froca.getNote(noteId);
    if (!note) return;

    // Get the box size from the parent section element
    const $section = $el.closest('section.include-note');
    const boxSize = $section.attr('data-box-size');
    const isExpandable = boxSize === 'expandable';

    const $wrapper = $('<div class="include-note-wrapper">');
    const $link = await link.createLink(note.noteId, {
        showTooltip: false
    });

    if (isExpandable) {
        // Create expandable structure with toggle
        const $titleRow = $('<div class="include-note-title-row">');
        const $toggle = $('<button class="include-note-toggle bx bx-chevron-right" aria-expanded="false">');
        const $title = $('<h4 class="include-note-title">').append($link);

        $titleRow.append($toggle, $title);
        $wrapper.append($titleRow);

        const { $renderedContent, type } = await content_renderer.getRenderedContent(note);
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

        const { $renderedContent, type } = await content_renderer.getRenderedContent(note);
        $wrapper.append($(`<div class="include-note-content type-${type}">`).append($renderedContent));
    }

    $el.empty().append($wrapper);

    // Watch for box-size attribute changes and re-render
    setupBoxSizeObserver($section[0], noteId, $el);
}

// Track observers to avoid duplicates
const boxSizeObservers = new WeakMap<Element, MutationObserver>();

function setupBoxSizeObserver(section: Element, noteId: string, $el: JQuery<HTMLElement>) {
    // Clean up existing observer if any
    const existingObserver = boxSizeObservers.get(section);
    if (existingObserver) {
        existingObserver.disconnect();
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'data-box-size') {
                // Re-render the included note with the new box size
                loadIncludedNote(noteId, $el);
                break;
            }
        }
    });

    observer.observe(section, {
        attributes: true,
        attributeFilter: ['data-box-size']
    });

    boxSizeObservers.set(section, observer);
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
