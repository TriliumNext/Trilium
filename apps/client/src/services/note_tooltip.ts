import appContext from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import attributeRenderer from "./attribute_renderer.js";
import contentRenderer from "./content_renderer.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import linkService from "./link.js";
import treeService from "./tree.js";
import utils from "./utils.js";

// Track all elements that open tooltips
let openTooltipElements: JQuery<HTMLElement>[] = [];
let dismissTimer: ReturnType<typeof setTimeout>;

function setupGlobalTooltip() {
    $(document).on("pointerenter", "a:not(.no-tooltip-preview)", mouseEnterHandler);
    $(document).on("pointerenter", "[data-href]:not(.no-tooltip-preview)", mouseEnterHandler);

    // close any note tooltip after click, this fixes the problem that sometimes tooltips remained on the screen
    $(document).on("click", (e) => {
        if ($(e.target).closest(".note-tooltip").length) {
            // click within the tooltip shouldn't close it
            return;
        }

        dismissAllTooltips();
    });
}

function dismissAllTooltips() {
    clearTimeout(dismissTimer);
    openTooltipElements.forEach($el => {
        $el.tooltip("dispose");
        $el.removeAttr("aria-describedby");
    });
    openTooltipElements = [];
}

function setupElementTooltip($el: JQuery<HTMLElement>) {
    $el.on("pointerenter", mouseEnterHandler);
}

async function mouseEnterHandler<T>(this: HTMLElement, e: JQuery.TriggeredEvent<T, undefined, T, T>) {
    if (e.pointerType !== "mouse") return;

    const $link = $(this);

    if ($link.hasClass("no-tooltip-preview") || $link.hasClass("disabled")) {
        return;
    } else if ($link.closest(".ck-link-actions").length) {
        // this is to avoid showing tooltip from inside the CKEditor link editor dialog
        return;
    } else if ($link.closest(".note-tooltip").length) {
        // don't show tooltip for links within tooltip
        return;
    }

    const url = $link.attr("href") || $link.attr("data-href");
    const { notePath, noteId, viewScope } = linkService.parseNavigationStateFromUrl(url);

    if (url?.startsWith("#fnref")) {
        // The "^" symbol from footnotes within text notes, doesn't require a tooltip.
        return;
    }

    if (!notePath || !noteId || viewScope?.viewMode !== "default") {
        return;
    }

    const linkId = $link.attr("data-link-id") || `link-${Math.floor(Math.random() * 1000000)}`;
    $link.attr("data-link-id", linkId);

    if ($(`.${linkId}`).is(":visible")) {
        // tooltip is already open for this link
        return;
    }

    let renderPromise;
    let note: FNote | null = null;
    if (url && url.startsWith("#") && !url.startsWith("#root/")) {
        renderPromise = renderFootnoteOrAnchor($link, url);
    } else {
        note = await froca.getNote(noteId);
        renderPromise = renderTooltip(note);
    }

    const [content] = await Promise.all([
        renderPromise,
        // to reduce flicker due to accidental mouseover, cursor must stay for a bit over the link for tooltip to appear
        new Promise((res) => setTimeout(res, 500))
    ]);

    if (!content || utils.isHtmlEmpty(content)) {
        return;
    }

    const html = `<div class="note-tooltip-content">${content}</div>`;
    const tooltipClass = `tooltip-${Math.floor(Math.random() * 999_999_999)}${note ? ` ${note.getColorClass()}` : ""}`;

    // we need to check if we're still hovering over the element
    // since the operation to get tooltip content was async, it is possible that
    // we now create tooltip which won't close because it won't receive mouseleave event
    if ($link.filter(":hover").length > 0) {
        $link.tooltip({
            container: "body",
            // https://github.com/zadam/trilium/issues/2794 https://github.com/zadam/trilium/issues/2988
            // with bottom this flickering happens a bit less
            placement: "bottom",
            trigger: "manual",
            //TODO: boundary No longer applicable?
            //boundary: 'window',
            title: html,
            html: true,
            template: `<div class="tooltip note-tooltip ${tooltipClass}" role="tooltip"><div class="arrow"></div><div class="tooltip-inner"></div></div>`,
            sanitize: false,
            customClass: linkId
        });

        dismissAllTooltips();
        $link.tooltip("show");

        openTooltipElements.push($link);

        // Dismiss the tooltip immediately if a link was clicked inside the tooltip.
        $(`.${tooltipClass} a`).on("click", (e) => {
            dismissAllTooltips();
        });

        // the purpose of the code below is to:
        // - allow user to go from hovering the link to hovering the tooltip to be able to scroll,
        //   click on links within tooltip etc. without tooltip disappearing
        // - once the user moves the cursor away from both link and the tooltip, hide the tooltip
        const checkTooltip = () => {

            if (!$link.filter(":hover").length && !$(`.${linkId}:hover`).length) {
                // cursor is neither over the link nor over the tooltip, user likely is not interested
                dismissAllTooltips();
            } else {
                dismissTimer = setTimeout(checkTooltip, 1000);
            }
        };

        dismissTimer = setTimeout(checkTooltip, 1000);
    }
}

async function renderTooltip(note: FNote | null) {
    if (!note) {
        return `<div>${t("note_tooltip.note-has-been-deleted")}</div>`;
    }

    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const bestNotePath = note.getBestNotePathString(hoistedNoteId);

    if (!bestNotePath) {
        return;
    }

    const noteTitleWithPathAsSuffix = await treeService.getNoteTitleWithPathAsSuffix(bestNotePath);

    const { $renderedAttributes } = await attributeRenderer.renderNormalAttributes(note);

    const { $renderedContent } = await contentRenderer.getRenderedContent(note, {
        tooltip: true,
        trim: true
    });
    const isContentEmpty = $renderedContent[0].innerHTML.length === 0;

    let content = "";
    if (noteTitleWithPathAsSuffix) {
        const classes = ["note-tooltip-title"];
        if (isContentEmpty) {
            classes.push("note-no-content");
        }
        content = `\
            <h5 class="${classes.join(" ")}">
                <a href="#${note.noteId}" data-no-context-menu="true">${noteTitleWithPathAsSuffix.prop("outerHTML")}</a>
            </h5>`;
    }

    content = `${content}<div class="note-tooltip-attributes">${$renderedAttributes[0].outerHTML}</div>`;
    if (!isContentEmpty) {
        content += $renderedContent[0].outerHTML;
    }

    content += `<a class="open-popup-button" title="${t("note_tooltip.quick-edit")}" href="#${note.noteId}?popup"><span class="bx bx-edit" /></a>`;
    return content;
}

function renderFootnoteOrAnchor($link: JQuery<HTMLElement>, url: string) {
    // A footnote text reference
    const footnoteRef = url.substring(3);
    let $targetContent: JQuery<HTMLElement>;

    if (url.startsWith("#fn")) {
        $targetContent = $link
            .closest(".ck-content") // find the parent CK content
            .find("> .footnote-section") // find the footnote section
            .find(`a[href="#fnref${footnoteRef}"]`) // find the footnote link
            .closest(".footnote-item") // find the parent container of the footnote
            .find(".footnote-content"); // find the actual text content of the footnote
    } else {
        $targetContent = $link
            .closest(".ck-content")
            .find(url)
            .closest("p");
    }

    if (!$targetContent.length) {
        // If the target content is not found, return an empty string
        return "";
    }

    const isEditable = $link.closest(".ck-content").hasClass("note-detail-editable-text-editor");
    if (isEditable) {
        /* Remove widget buttons for tables, formulas, and images in editable notes. */
        $targetContent.find('.ck-widget__selection-handle').remove();
        $targetContent.find('.ck-widget__type-around').remove();
        $targetContent.find('.ck-widget__resizer').remove();

        /* Handling in-line math formulas */
        $targetContent.find('.ck-math-tex.ck-math-tex-inline.ck-widget').each(function () {
            const $katex = $(this).find('.katex').first();
            if ($katex.length) {
                $(this).replaceWith($('<span class="math-tex"></span>').append($('<span></span>').append($katex.clone())));
            }
        });
    }

    let footnoteContent = $targetContent.html();
    footnoteContent = `<div class="ck-content">${footnoteContent}</div>`;
    return footnoteContent || "";
}

export default {
    setupGlobalTooltip,
    setupElementTooltip,
    dismissAllTooltips
};
