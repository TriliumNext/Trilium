import { ALLOWED_PROTOCOLS } from "@triliumnext/commons";

import appContext, { type NoteCommandData } from "../components/app_context.js";
import { openInCurrentNoteContext } from "../components/note_context.js";
import linkContextMenuService from "../menus/link_context_menu.js";
import froca from "./froca.js";
import treeService from "./tree.js";
import utils from "./utils.js";

function getNotePathFromUrl(url: string) {
    const notePathMatch = /#(root[A-Za-z0-9_/]*)$/.exec(url);

    return notePathMatch === null ? null : notePathMatch[1];
}

async function getLinkIcon(noteId: string, viewMode: ViewMode | undefined) {
    let icon;

    if (!viewMode || viewMode === "default") {
        const note = await froca.getNote(noteId);

        icon = note?.getIcon();
    } else if (viewMode === "source") {
        icon = "bx bx-code-curly";
    } else if (viewMode === "attachments") {
        icon = "bx bx-file";
    }
    return icon;
}

export type ViewMode = "default" | "source" | "attachments" | "contextual-help" | "note-map";

export interface ViewScope {
    /**
     * - "source", when viewing the source code of a note.
     * - "attachments", when viewing the attachments of a note.
     * - "contextual-help", if the current view represents a help window that was opened to the side of the main content.
     * - "default", otherwise.
     */
    viewMode?: ViewMode;
    attachmentId?: string;
    readOnlyTemporarilyDisabled?: boolean;
    /**
     * If true, it indicates that the note in the view should be opened in read-only mode (for supported note types such as text or code).
     *
     * The reason why we store this information here is that a note can become read-only as the user types content in it, and we wouldn't want
     * to immediately enter read-only mode.
     */
    isReadOnly?: boolean;
    highlightsListPreviousVisible?: boolean;
    highlightsListTemporarilyHidden?: boolean;
    tocTemporarilyHidden?: boolean;
    /*
     * The reason for adding tocPreviousVisible is to record whether the previous state of the toc is hidden or displayed,
     * and then let it be displayed/hidden at the initial time. If there is no such value,
     * when the right panel needs to display highlighttext but not toc, every time the note content is changed,
     * toc will appear and then close immediately, because getToc(html) function will consume time
     */
    tocPreviousVisible?: boolean;
    tocCollapsedHeadings?:  Set<string>;
}

interface CreateLinkOptions {
    title?: string;
    showTooltip?: boolean;
    showNotePath?: boolean;
    showNoteIcon?: boolean;
    referenceLink?: boolean;
    autoConvertToImage?: boolean;
    viewScope?: ViewScope;
}

async function createLink(notePath: string | undefined, options: CreateLinkOptions = {}) {
    if (!notePath || !notePath.trim()) {
        logError("Missing note path");

        return $("<span>").text("[missing note]");
    }

    if (!notePath.startsWith("root")) {
        // all note paths should start with "root/" (except for "root" itself)
        // used, e.g., to find internal links
        notePath = `root/${notePath}`;
    }

    const showTooltip = options.showTooltip === undefined ? true : options.showTooltip;
    const showNotePath = options.showNotePath === undefined ? false : options.showNotePath;
    const showNoteIcon = options.showNoteIcon === undefined ? false : options.showNoteIcon;
    const referenceLink = options.referenceLink === undefined ? false : options.referenceLink;
    const autoConvertToImage = options.autoConvertToImage === undefined ? false : options.autoConvertToImage;

    const { noteId, parentNoteId } = treeService.getNoteIdAndParentIdFromUrl(notePath);
    if (!noteId) {
        logError("Missing note ID");

        return $("<span>").text("[missing note]");
    }

    const viewScope = options.viewScope || {};
    const viewMode = viewScope.viewMode || "default";
    let linkTitle = options.title;

    if (linkTitle === undefined) {
        if (viewMode === "attachments" && viewScope.attachmentId) {
            const attachment = await froca.getAttachment(viewScope.attachmentId);

            linkTitle = attachment ? attachment.title : "[missing attachment]";
        } else if (noteId) {
            linkTitle = await treeService.getNoteTitle(noteId, parentNoteId);
        }
    }

    const note = await froca.getNote(noteId);

    if (autoConvertToImage && note?.type && ["image", "canvas", "mermaid"].includes(note.type) && viewMode === "default") {
        const encodedTitle = encodeURIComponent(linkTitle || "");

        return $("<img>")
            .attr("src", `api/images/${noteId}/${encodedTitle}?${Math.random()}`)
            .attr("alt", linkTitle || "");
    }

    const $container = $("<span>");

    if (showNoteIcon) {
        const icon = await getLinkIcon(noteId, viewMode);

        if (icon) {
            $container.append($("<span>").addClass(`bx ${icon}`)).append(" ");
        }
    }

    const hash = calculateHash({
        notePath,
        viewScope
    });

    const $noteLink = $("<a>", {
        href: hash,
        text: linkTitle
    });

    if (!showTooltip) {
        $noteLink.addClass("no-tooltip-preview");
    }

    if (referenceLink) {
        $noteLink.addClass("reference-link");
    }

    $container.append($noteLink);

    if (showNotePath) {
        let pathSegments: string[];
        if (notePath == "root") {
            pathSegments = ["⌂"];
        } else {
            const resolvedPathSegments = (await treeService.resolveNotePathToSegments(notePath)) || [];
            resolvedPathSegments.pop(); // Remove last element

            const resolvedPath = resolvedPathSegments.join("/");
            pathSegments = await treeService.getNotePathTitleComponents(resolvedPath);
        }

        if (pathSegments) {
            if (pathSegments.length) {
                $container.append($("<small>").append(treeService.formatNotePath(pathSegments)));
            }
        }
    }

    return $container;
}

export function calculateHash({ notePath, ntxId, hoistedNoteId, viewScope = {} }: NoteCommandData) {
    notePath = notePath || "";
    const params = [
        ntxId ? { ntxId } : null,
        hoistedNoteId && hoistedNoteId !== "root" ? { hoistedNoteId } : null,
        viewScope.viewMode && viewScope.viewMode !== "default" ? { viewMode: viewScope.viewMode } : null,
        viewScope.attachmentId ? { attachmentId: viewScope.attachmentId } : null
    ].filter((p) => !!p);

    const paramStr = params
        .map((pair) => {
            const name = Object.keys(pair)[0];
            const value = (pair as Record<string, string | undefined>)[name];

            return `${encodeURIComponent(name)}=${encodeURIComponent(value || "")}`;
        })
        .join("&");

    if (!notePath && !paramStr) {
        return "";
    }

    let hash = `#${notePath}`;

    if (paramStr) {
        hash += `?${paramStr}`;
    }

    return hash;
}

export function parseNavigationStateFromUrl(url: string | undefined) {
    if (!url) {
        return {};
    }

    url = url.trim();
    const hashIdx = url.indexOf("#");
    if (hashIdx === -1) {
        return {};
    }

    // Exclude external links that contain #
    if (hashIdx !== 0 && !url.includes("/#root") && !url.includes("/#?searchString") && !url.includes("/?extraWindow")) {
        return {};
    }

    const hash = url.substr(hashIdx + 1); // strip also the initial '#'
    const [notePath, paramString] = hash.split("?");

    const viewScope: ViewScope = {
        viewMode: "default"
    };
    let ntxId: string | null = null;
    let hoistedNoteId: string | null = null;
    let searchString: string | null = null;
    let openInPopup = false;

    if (paramString) {
        for (const pair of paramString.split("&")) {
            let [name, value] = pair.split("=");
            name = decodeURIComponent(name);
            value = decodeURIComponent(value);

            if (name === "ntxId") {
                ntxId = value;
            } else if (name === "hoistedNoteId") {
                hoistedNoteId = value;
            } else if (name === "searchString") {
                searchString = value; // supports triggering search from URL, e.g. #?searchString=blabla
            } else if (["viewMode", "attachmentId"].includes(name)) {
                (viewScope as any)[name] = value;
            } else if (name === "popup") {
                openInPopup = true;
            } else {
                console.warn(`Unrecognized hash parameter '${name}'.`);
            }
        }
    }

    if (searchString) {
        return { searchString };
    }

    if (!notePath.match(/^[_a-z0-9]{4,}(\/[_a-z0-9]{4,})*$/i)) {
        return {};
    }

    return {
        notePath,
        noteId: treeService.getNoteIdFromUrl(notePath),
        ntxId,
        hoistedNoteId,
        viewScope,
        searchString,
        openInPopup
    };
}

function goToLink(evt: MouseEvent | JQuery.ClickEvent | JQuery.MouseDownEvent) {
    const $link = $(evt.target as any).closest("a,.block-link");
    const hrefLink = $link.attr("href") || $link.attr("data-href");

    return goToLinkExt(evt, hrefLink, $link);
}

/**
 * Handles navigation to a link, which can be an internal note path (e.g., `#root/1234`) or an external URL (e.g., `https://example.com`).
 *
 * @param evt the event that triggered the link navigation, or `null` if the link was clicked programmatically. Used to determine if the link should be opened in a new tab/window, based on the button presses.
 * @param hrefLink the link to navigate to, which can be a note path (e.g., `#root/1234`) or an external URL with any supported protocol (e.g., `https://example.com`).
 * @param $link the jQuery element of the link that was clicked, used to determine if the link is an anchor link (e.g., `#fn1` or `#fnref1`) and to handle it accordingly.
 * @returns `true` if the link was handled (i.e., the element was found and scrolled to), or a falsy value otherwise.
 */
export function goToLinkExt(evt: MouseEvent | JQuery.ClickEvent | JQuery.MouseDownEvent | React.PointerEvent<HTMLCanvasElement> | null, hrefLink: string | undefined, $link?: JQuery<HTMLElement> | null) {
    if (hrefLink?.startsWith("data:")) {
        return true;
    }

    evt?.preventDefault();
    evt?.stopPropagation();

    if (hrefLink && hrefLink.startsWith("#") && !hrefLink.startsWith("#root/") && $link) {
        if (handleAnchor(hrefLink, $link)) {
            return true;
        }
    }

    const { notePath, viewScope, openInPopup } = parseNavigationStateFromUrl(hrefLink);

    const ctrlKey = evt && utils.isCtrlKey(evt);
    const shiftKey = evt?.shiftKey;
    const isLeftClick = !evt || ("which" in evt && evt.which === 1);
    // Right click is handled separately.
    const isMiddleClick = evt && "which" in evt && evt.which === 2;
    const targetIsBlank = ($link?.attr("target") === "_blank");
    const isDoubleClick = isLeftClick && evt?.type === "dblclick";
    const openInNewTab = (isLeftClick && ctrlKey) || isDoubleClick || isMiddleClick || targetIsBlank;
    const activate = (isLeftClick && ctrlKey && shiftKey) || (isMiddleClick && shiftKey);
    const openInNewWindow = isLeftClick && evt?.shiftKey && !ctrlKey;

    if (notePath) {
        if (isLeftClick && openInPopup) {
            appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
        } else if (openInNewWindow) {
            appContext.triggerCommand("openInWindow", { notePath, viewScope });
        } else if (openInNewTab) {
            appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                activate: activate ? true : targetIsBlank,
                viewScope
            });
        } else if (isLeftClick) {
            openInCurrentNoteContext(evt, notePath, viewScope);
        }
    } else if (hrefLink) {
        const withinEditLink = $link?.hasClass("ck-link-actions__preview");
        const outsideOfCKEditor = !$link || $link.closest("[contenteditable]").length === 0;

        if (openInNewTab || openInNewWindow || (isLeftClick && (withinEditLink || outsideOfCKEditor))) {
            if (hrefLink.toLowerCase().startsWith("http") || hrefLink.startsWith("api/")) {
                window.open(hrefLink, "_blank");
            } else {
                // Enable protocols supported by CKEditor 5 to be clickable.
                if (ALLOWED_PROTOCOLS.some((protocol) => hrefLink.toLowerCase().startsWith(`${protocol}:`))) {
                    if ( utils.isElectron()) {
                        const electron = utils.dynamicRequire("electron");
                        electron.shell.openExternal(hrefLink);
                    } else {
                        window.open(hrefLink, "_blank");
                    }
                }
            }
        }
    }

    return true;
}

/**
 * Scrolls to either the footnote (if clicking on a reference such as `[1]`), or to the reference of a footnote (if clicking on the footnote `^` arrow),
 * or CKEditor bookmarks.
 *
 * @param hrefLink the URL of the link that was clicked (it should be in the form of `#fn` or `#fnref`).
 * @param $link the element of the link that was clicked.
 * @returns `true` if the link was handled (i.e., the element was found and scrolled to), `false` otherwise.
 */
function handleAnchor(hrefLink: string, $link: JQuery<HTMLElement>) {
    const el = $link.closest(".ck-content").find(hrefLink)[0];
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return !!el;
}

function linkContextMenu(e: PointerEvent) {
    const $link = $(e.target as any).closest("a");
    const url = $link.attr("href") || $link.attr("data-href");

    if ($link.attr("data-no-context-menu")) {
        return;
    }

    const { notePath, viewScope } = parseNavigationStateFromUrl(url);

    if (!notePath) {
        return;
    }

    if (utils.isCtrlKey(e) && e.button === 2) {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
        e.preventDefault();
        return;
    }

    e.preventDefault();

    linkContextMenuService.openContextMenu(notePath, e, viewScope, null);
}

async function loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string | null | undefined = null) {
    const $link = $el[0].tagName === "A" ? $el : $el.find("a");

    href = href || $link.attr("href");
    if (!href) {
        console.warn(`Empty URL for parsing: ${$el[0].outerHTML}`);
        return;
    }

    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        console.warn("Missing note ID.");
        return;
    }

    const note = await froca.getNote(noteId, true);

    if (note) {
        $el.addClass(note.getColorClass());
    }

    const title = await getReferenceLinkTitle(href);
    $el.text(title);

    if (note) {
        const icon = await getLinkIcon(noteId, viewScope.viewMode);

        if (icon) {
            $el.prepend($("<span>").addClass(icon));
        }
    }
}

async function getReferenceLinkTitle(href: string) {
    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        return "[missing note]";
    }

    const note = await froca.getNote(noteId);
    if (!note) {
        return "[missing note]";
    }

    if (viewScope?.viewMode === "attachments" && viewScope?.attachmentId) {
        const attachment = await note.getAttachmentById(viewScope.attachmentId);

        return attachment ? attachment.title : "[missing attachment]";
    }
    return note.title;

}

function getReferenceLinkTitleSync(href: string) {
    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        return "[missing note]";
    }

    const note = froca.getNoteFromCache(noteId);
    if (!note) {
        return "[missing note]";
    }

    if (viewScope?.viewMode === "attachments" && viewScope?.attachmentId) {
        if (!note.attachments) {
            return "[loading title...]";
        }

        const attachment = note.attachments.find((att) => att.attachmentId === viewScope.attachmentId);

        return attachment ? attachment.title : "[missing attachment]";
    }
    return note.title;

}

if (glob.device !== "print") {
    // TODO: Check why the event is not supported.
    //@ts-ignore
    $(document).on("click", "a", goToLink);
    // TODO: Check why the event is not supported.
    //@ts-ignore
    $(document).on("auxclick", "a", goToLink); // to handle the middle button
    // TODO: Check why the event is not supported.
    //@ts-ignore
    $(document).on("contextmenu", "a", linkContextMenu);
    // TODO: Check why the event is not supported.
    //@ts-ignore
    $(document).on("dblclick", "a", goToLink);

    $(document).on("mousedown", "a", (e) => {
        if (e.which === 2) {
            // prevent paste on middle click
            // https://github.com/zadam/trilium/issues/2995
            // https://developer.mozilla.org/en-US/docs/Web/API/Element/auxclick_event#preventing_default_actions
            e.preventDefault();
            return false;
        }
    });
}

export default {
    getNotePathFromUrl,
    createLink,
    goToLink,
    goToLinkExt,
    loadReferenceLinkTitle,
    getReferenceLinkTitle,
    getReferenceLinkTitleSync,
    calculateHash,
    parseNavigationStateFromUrl
};
