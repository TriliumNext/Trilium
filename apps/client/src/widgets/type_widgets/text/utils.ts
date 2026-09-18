import appContext from "../../../components/app_context";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link, { ViewScope } from "../../../services/link";
import { extractLanguageFromClassList } from "../../../services/syntax_highlight";
import utils from "../../../services/utils";
import type { ContentLightboxData } from "../../dialogs/content_lightbox";

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

        // The include widget itself is the first level of inclusion, so the included note's own
        // includes are rendered as reference links rather than expanded (see includesAsReferenceLinks).
        const { $renderedContent, type } = await content_renderer.getRenderedContent(note, { interactive: true, includesAsReferenceLinks: true, mediaEnvironment: "embedded" });
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

        // The include widget itself is the first level of inclusion, so the included note's own
        // includes are rendered as reference links rather than expanded (see includesAsReferenceLinks).
        const { $renderedContent, type } = await content_renderer.getRenderedContent(note, { interactive: true, includesAsReferenceLinks: true, mediaEnvironment: "embedded" });
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
    // The read-only view renders into a persistent element, so this runs again on every content
    // change against the same container; the namespace lets the previous handlers be dropped.
    $container.off("dblclick.imageOpening click.imageOpening");
    $container.on("dblclick.imageOpening", "img", (e) => openImageInCurrentTab($(e.target)));
    $container.on("click.imageOpening", "img", (e) => {
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

export type ExpansionTarget =
    | { type: "navigate"; noteId: string }
    | { type: "lightbox"; data: ContentLightboxData };

/**
 * Installs the double-click gesture that expands an inline diagram, formula or code block.
 *
 * Code blocks are opted out of in edit mode, where a double click is the word-selection gesture.
 */
export function setupContentExpansion(container: HTMLDivElement, { codeBlocks }: { codeBlocks: boolean }) {
    if (glob.device === "print") return;

    const $container = $(container);
    $container.off("dblclick.contentExpansion click.contentExpansion");
    $container.on("dblclick.contentExpansion", (e) => {
        const resolution = resolveExpansionTarget(e.target as Element, { codeBlocks });
        if (!resolution) return;

        e.stopPropagation();
        runExpansion(resolution, { newTab: false, activate: false });
    });
    // Ctrl-click and middle-click open a note in another tab, matching what images already do; a
    // plain click keeps whatever meaning the content itself has.
    $container.on("click.contentExpansion", (e) => {
        const isLeftClick = e.which === 1;
        const isMiddleClick = e.which === 2;
        const ctrlKey = utils.isCtrlKey(e);
        if (!((isLeftClick && ctrlKey) || isMiddleClick)) return;

        const resolution = resolveExpansionTarget(e.target as Element, { codeBlocks, navigateOnly: true });
        if (resolution?.type !== "navigate") return;

        e.stopPropagation();
        const activate = (isLeftClick && ctrlKey && e.shiftKey) || (isMiddleClick && e.shiftKey);
        runExpansion(resolution, { newTab: true, activate });
    });
}

/**
 * Decides what a double click on `target` expands, or `null` when the gesture belongs elsewhere.
 *
 * `navigateOnly` narrows the answer to the note-navigation case, so a caller that acts on nothing
 * else stops before `serializeSvgForLightbox` copies a whole diagram.
 */
export function resolveExpansionTarget(target: Element, { codeBlocks, navigateOnly = false }: { codeBlocks: boolean; navigateOnly?: boolean }): ExpansionTarget | null {
    if (target.closest("a, button, textarea.ck-mermaid__editing-view")) {
        return null;
    }

    const svg = target.closest<SVGSVGElement>("svg");
    // Checked before the code-block diagrams so an included one navigates instead of opening a copy.
    if (svg?.closest(".include-note-content")?.classList.contains("type-mermaid")) {
        const noteId = svg.closest<HTMLElement>("section.include-note")?.dataset.noteId;
        return noteId ? { type: "navigate", noteId } : null;
    }

    if (navigateOnly) {
        return null;
    }

    if (svg?.closest('div.mermaid-diagram[data-processed="true"], div.ck-mermaid__preview')) {
        return { type: "lightbox", data: { kind: "svg", svg: serializeSvgForLightbox(svg) } };
    }

    const math = target.closest("span.math-tex, .ck-math-tex");
    if (math) {
        // KaTeX has not run yet on a formula that carries no rendered output.
        const katex = math.querySelector(".katex-display") ?? math.querySelector(".katex");
        return katex ? { type: "lightbox", data: { kind: "html", html: katex.outerHTML } } : null;
    }

    if (codeBlocks) {
        const code = target.closest("pre")?.querySelector(":scope > code");
        if (code instanceof HTMLElement) {
            return { type: "lightbox", data: { kind: "code", code: code.textContent ?? "", language: extractLanguageFromClassList(code) } };
        }
    }

    return null;
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

/**
 * Copies a rendered mermaid diagram into standalone markup the lightbox can lay out.
 *
 * Mermaid scopes its `<style>` rules to the svg id and prefixes every `<marker id>` and `url(#…)`
 * reference with it, so replacing the id throughout keeps the copy self-contained instead of
 * resolving against the original, which can sit inside a collapsed include. A `useMaxWidth` diagram
 * carries `width="100%"` plus an inline `max-width`, which cannot size itself in a `fit-content`
 * box, so the viewBox supplies explicit dimensions.
 */
function serializeSvgForLightbox(svg: SVGSVGElement) {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const [ , , width, height ] = (clone.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/);
    if (width && height) {
        clone.setAttribute("width", width);
        clone.setAttribute("height", height);
        clone.style.removeProperty("max-width");
    }

    const markup = clone.outerHTML;
    const id = svg.getAttribute("id");
    return id ? markup.split(id).join(`${id}-lightbox`) : markup;
}

function runExpansion(resolution: ExpansionTarget, { newTab, activate }: { newTab: boolean; activate: boolean }) {
    if (resolution.type === "lightbox") {
        appContext.triggerCommand("showContentLightbox", resolution.data);
    } else if (newTab) {
        appContext.tabManager.openTabWithNoteWithHoisting(resolution.noteId, { activate });
    } else {
        appContext.tabManager.getActiveContext()?.setNote(resolution.noteId);
    }
}
