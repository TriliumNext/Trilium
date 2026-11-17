import { resolveBlockReference } from "@triliumnext/commons/src/lib/block_reference.js";
import { ALLOWED_PROTOCOLS } from "@triliumnext/commons/src/lib/shared_constants.js";

import appContext from "../components/app_context.js";
import { openInCurrentNoteContext } from "../components/note_context.js";
import {
    getBlockReferenceLabel, getCachedBlockReferenceLabel, loadBlockReferenceLabel
} from "./block_excerpts.js";
import cssClassManager from "./css_class_manager.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { getNoteImageUrl } from "./image_urls.js";
import {
    calculateExtraWindowUrl, calculateHash, parseNavigationStateFromUrl, type ViewMode, type ViewScope
} from "./navigation_state.js";
import { showError } from "./toast.js";
import treeService from "./tree.js";
import utils, { isShare } from "./utils.js";

/** The icon a column reference uses when the link carries no `columnIcon`. */
const DEFAULT_COLUMN_REFERENCE_ICON = "bx bx-columns";
const MISSING_NOTE_TITLE = "[missing note]";

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
        icon = "tn-icon bx bx-code-curly";
    } else if (viewMode === "attachments") {
        icon = "tn-icon bx bx-file";
    }
    return icon;
}

interface CreateLinkOptions {
    title?: string;
    showTooltip?: boolean;
    showNotePath?: boolean;
    showNoteIcon?: boolean;
    referenceLink?: boolean;
    autoConvertToImage?: boolean;
    viewScope?: ViewScope;
    /**
     * Inline text appended right after the link title (before the note path, which renders on its
     * own line). Rendered as a `.note-link-suffix` span so it rides the title's baseline instead of
     * being pushed into a column by the wider note-path block — e.g. an annotation on why the note
     * is being shown.
     */
    titleSuffix?: string;
}

async function createLink(notePath: string | undefined, options: CreateLinkOptions = {}) {
    if (!notePath || !notePath.trim()) {
        logError("Missing note path");

        return $("<span>").text(MISSING_NOTE_TITLE);
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

        return $("<span>").text(MISSING_NOTE_TITLE);
    }

    const viewScope = options.viewScope || {};
    const viewMode = viewScope.viewMode || "default";
    let linkTitle = options.title;

    if (linkTitle === undefined) {
        /* v8 ignore start -- the implicit `else` of this chain (noteId falsy) is unreachable: an empty noteId already returned at the guard above */
        if (viewMode === "attachments" && viewScope.attachmentId) {
            const attachment = await froca.getAttachment(viewScope.attachmentId);

            linkTitle = attachment ? attachment.title : "[missing attachment]";
        } else if (noteId) {
            linkTitle = await treeService.getNoteTitle(noteId, parentNoteId);
        }
        /* v8 ignore stop */
    }

    const note = await froca.getNote(noteId);

    if (autoConvertToImage && note?.type && ["image", "canvas", "mermaid"].includes(note.type) && viewMode === "default") {
        return $("<img>")
            .attr("src", getNoteImageUrl(noteId, linkTitle || "", String(Math.random())))
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

    if (options.titleSuffix) {
        $container.append($("<span>").addClass("note-link-suffix").text(options.titleSuffix));
    }

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

        /* v8 ignore next 2 -- defensive guards: pathSegments is always a non-empty array (getNotePathTitleComponents never returns empty, and the root case yields ["⌂"]) */
        if (pathSegments) {
            if (pathSegments.length) {
                $container.append($("<small>").append(treeService.formatNotePath(pathSegments)));
            }
        }
    }

    return $container;
}

/**
 * Interactive content that handles its own clicks opts out of link navigation by carrying this class. It is
 * needed where such content sits inside a link — a media player in a collection card, whose card is itself a
 * `.block-link` — so that pressing play doesn't also open the note. Marking the content is what lets its
 * clicks keep bubbling to the document, which the Bootstrap dropdowns inside it rely on; stopping propagation
 * at the player would kill link navigation and those dropdowns alike.
 */
const NO_LINK_NAVIGATION_SELECTOR = ".no-link-navigation";

function goToLink(evt: MouseEvent | JQuery.ClickEvent | JQuery.MouseDownEvent) {
    const $target = $(evt.target as any);
    if ($target.closest(NO_LINK_NAVIGATION_SELECTOR).length) {
        return false;
    }

    const $link = $target.closest("a,.block-link");
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

    // The preview button of the text editor's link toolbar acts on its clicks alone, and the
    // editor has handled a click that jumped into the note itself.
    if (evt && $link?.hasClass("ck-link-toolbar__preview")
        && (evt.type === "dblclick" || isDefaultPrevented(evt))) {
        return true;
    }

    evt?.preventDefault();
    evt?.stopPropagation();

    const ctrlKey = evt && utils.isCtrlKey(evt);
    const shiftKey = evt?.shiftKey;
    const isLeftClick = !evt || ("which" in evt && evt.which === 1);
    // Right click is handled separately.
    const isMiddleClick = evt && "which" in evt && evt.which === 2;
    // The preview button of the text editor's link toolbar opens a note in place, as a link does.
    const isLinkToolbarPreview = !!$link?.hasClass("ck-link-toolbar__preview");
    const targetIsBlank = $link?.attr("target") === "_blank" && !isLinkToolbarPreview;
    const isDoubleClick = isLeftClick && evt?.type === "dblclick";
    const isPlainLeftClick = isLeftClick && !ctrlKey && !shiftKey && !isDoubleClick;
    const isInEditor = !!$link && isInEditableText($link);
    // In the text being edited, these follow the link as the first button of its toolbar does.
    const isFollowClick = isInEditor && isLeftClick && !shiftKey && (ctrlKey || isDoubleClick);
    const openInNewTab = !isFollowClick
        && ((isLeftClick && (ctrlKey || targetIsBlank)) || isDoubleClick || isMiddleClick);
    const activate = (isLeftClick && ctrlKey && shiftKey) || (isMiddleClick && shiftKey);
    const openInNewWindow = isLeftClick && evt?.shiftKey && !ctrlKey;

    if (hrefLink?.startsWith("#") && !hrefLink.startsWith("#root/") && $link) {
        // The link toolbar jumps to the anchor, and a footnote shows no toolbar.
        if (isPlainLeftClick && isInEditor
            && !$link.closest(".footnote-reference, .footnote-back-link").length) {
            return true;
        }
        if (handleAnchor(hrefLink, $link)) {
            return true;
        }
    }

    const { notePath, noteId, viewScope, openInPopup } = parseNavigationStateFromUrl(hrefLink);

    if (notePath) {
        if (isPlainLeftClick && isInEditor) {
            // The text editor shows the link toolbar, whose preview button opens the note.
            return true;
        }

        // A link to blocks of the note it is in acts as a link within a page.
        if ((isPlainLeftClick || isFollowClick) && !openInPopup && !targetIsBlank && $link
            && viewScope?.block && showBlocksInPlace($link, noteId, viewScope.block)) {
            return true;
        }

        if (isLeftClick && openInPopup) {
            appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath, viewScope });
        } else if (openInNewWindow) {
            appContext.triggerCommand("openInWindow", { notePath, viewScope });
        } else if (openInNewTab) {
            appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                activate: activate ? true : targetIsBlank,
                viewScope,
                placement: "afterCurrent"
            });
        } else if (isLeftClick) {
            openInCurrentNoteContext(evt, notePath, viewScope);
        }
    } else if (hrefLink) {
        const isInEditedContent = isInEditor
            || $link?.closest("[contenteditable]").attr("contenteditable") === "true";

        if (openInNewTab || openInNewWindow || isFollowClick
            || (isLeftClick && (isLinkToolbarPreview || !isInEditedContent))) {
            if (hrefLink.toLowerCase().startsWith("http") || hrefLink.startsWith("api/")) {
                window.open(hrefLink, "_blank");
            } else if (ALLOWED_PROTOCOLS.some((protocol) => hrefLink.toLowerCase().startsWith(`${protocol}:`))) {
                // Enable protocols supported by CKEditor 5 to be clickable.
                if (window.electronApi) {
                    const reportLinkError = (e: unknown) => {
                        const message = e instanceof Error ? e.message : String(e);
                        logError(`Failed to open link '${hrefLink}': ${message}`);
                        showError(t("link.failed_to_open", { href: hrefLink, message }));
                    };

                    if (hrefLink.toLowerCase().startsWith("file:")) {
                        // The main process resolves the URL to a path and picks the dispatch
                        // that works per platform; shell.openExternal alone mishandles Unicode
                        // file:// URLs on Windows.
                        window.electronApi.shell.openFileUrl(hrefLink).then((err: string) => {
                            if (err) reportLinkError(new Error(err));
                        }).catch(reportLinkError);
                    } else {
                        window.electronApi.shell.openExternal(hrefLink);
                    }
                } else {
                    window.open(hrefLink, "_blank");
                }
            }
        }
    }

    return true;
}

/**
 * Whether `$link` belongs to a text note being edited, in its text or in one of its widgets,
 * rather than to the read-only content of an embed in it.
 */
function isInEditableText($link: JQuery<HTMLElement>) {
    return $link.closest(".note-detail-editable-text-editor, .include-note-content")
        .hasClass("note-detail-editable-text-editor");
}

/**
 * Marks the document while Ctrl, or Cmd on macOS, is held: a click with it follows a link in the
 * text being edited, and `EditableText.css` shows a pointer over the link.
 */
function setFollowLinkKeyHeld(isHeld: boolean) {
    document.documentElement.classList.toggle("follow-link-key-held", isHeld);
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
    const content = $link.closest(".ck-content")[0];
    const name = hrefLink.slice(1);
    // Exact comparison: an anchor name can hold characters that a CSS selector does not allow.
    const isFound = !!content
        && Array.from(content.querySelectorAll("[id]")).some((element) => element.id === name);
    if (isFound) {
        void loadBlockJump().then(({ showAnchor }) => showAnchor(content, name));
    }
    return isFound;
}

/**
 * Scrolls to the blocks `block` of the note `noteId` and flashes them, when `$link` is in the
 * content of that note that holds them. Returns whether it does.
 */
function showBlocksInPlace($link: JQuery<HTMLElement>, noteId: string | null, block: string) {
    const jump = getBlockJump($link, noteId, block);
    jump?.show();
    return !!jump;
}

/** A jump to blocks of the note a link is in, which stays in that note. */
export interface BlockJump {
    /** Whether the blocks are a single heading. */
    isHeading: boolean;
    /** Scrolls to the blocks and flashes them. */
    show(): void;
}

/**
 * The jump to the blocks `block` of the note `noteId`, when `$link` is in the content of that note
 * that holds them, or `null`.
 */
function getBlockJump(
    $link: JQuery<HTMLElement>, noteId: string | null, block: string
): BlockJump | null {
    const content = $link.closest(".ck-content")[0];
    const ntxId = $link.closest("[data-ntx-id]").attr("data-ntx-id");
    if (!content || !ntxId || appContext.tabManager.getNoteContextById(ntxId).noteId !== noteId) {
        return null;
    }

    // A broken range is left to the note context, which also shows the error.
    const { start, end } = resolveBlockReference<Element>(content, block);
    if (!start || !end) {
        return null;
    }

    return {
        isHeading: start === end && /^H[1-6]$/.test(start.tagName),
        show: () => void loadBlockJump()
            .then(({ showBlockReference }) => showBlockReference(content, block))
    };
}

/** Whether something before `goToLinkExt()` already took the default action of `evt`. */
function isDefaultPrevented(evt: NonNullable<Parameters<typeof goToLinkExt>[0]>) {
    return "isDefaultPrevented" in evt ? evt.isDefaultPrevented() : evt.defaultPrevented;
}

/** The module that scrolls to blocks and anchors and flashes them, loaded on first use. */
function loadBlockJump() {
    return import("@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js");
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
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath, viewScope });
        e.preventDefault();
        return;
    }

    // The text editor opens the menu of the link toolbar for a link in the text being edited.
    if (isInEditableText($link) && !$link.closest(".include-note").length) {
        return;
    }

    e.preventDefault();

    // Loaded with the first right-click on a link: the menu imports the other context menus.
    void import("../menus/link_context_menu.js").then(({ default: linkContextMenuService }) => {
        linkContextMenuService.openContextMenu(notePath, e, viewScope, null);
    });
}

/**
 * Fills `$el` with the label of the reference link to `href`. A link to blocks of `hostNoteId`, the
 * note the link is in, shows only the text of the blocks, read from `content` when it holds them,
 * as an editor does. When `isExcerpt`, `content` holds only some blocks of the note, and the others
 * are read from the saved note. A link to a note that does not exist shows `storedTitle`, the title
 * the content holds for it.
 */
async function loadReferenceLinkTitle(
    $el: JQuery<HTMLElement>,
    href: string | null | undefined = null,
    hostNoteId?: string,
    storedTitle?: string,
    content?: ParentNode | null,
    isExcerpt = false
) {
    const $link = $el[0].tagName === "A" ? $el : $el.find("a");

    href = href || $link.attr("href");
    if (!href) {
        console.warn(`Empty URL for parsing: ${$el[0].outerHTML}`);
        return;
    }

    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        // Not returned on: the editing downcast creates an empty <span> that only this call fills.
        // An attachment image URL, an external link or imported HTML can carry such an href.
        console.warn("Missing note ID.");
    }

    // A card reference holds the board in its path and the card in `card`. The link renders the
    // card; the path is what it opens.
    const subjectId = viewScope?.card || noteId;
    const note = subjectId ? await froca.getNote(subjectId, true) : null;

    if (viewScope?.block && note && (content || noteId === hostNoteId)) {
        const liveLabel = content ? getBlockReferenceLabel(content, viewScope.block) : null;
        const label = liveLabel && !(liveLabel.isBroken && isExcerpt)
            ? liveLabel
            : await loadBlockReferenceLabel(note, viewScope.block) ?? liveLabel;
        if (label) {
            $el.text(label.text).toggleClass("block-reference-broken", label.isBroken);
            if (!label.isHeading) {
                $el.prepend($("<span>").addClass("tn-icon bx bx-paragraph"));
            }
            return;
        }
    }

    if (!note) {
        $el.text(storedTitle || MISSING_NOTE_TITLE)
            .addClass("reference-link-missing no-link-navigation")
            .prepend($("<span>").addClass("tn-icon bx bx-x"));
        return;
    }

    $el.addClass(note.getColorClass());

    const title = await getReferenceLinkTitle(href);
    // A column reference renders as "<board>: <column>", the column in a `<small>` below.
    $el.text(viewScope?.columnTitle ? `${title}:` : title);

    if (viewScope?.bookmark) {
        $el.append($("<small>").append(
            $("<span>").addClass("bx bx-bookmark"),
            document.createTextNode(viewScope.bookmark)
        ));
    }

    if (viewScope?.block) {
        const label = await loadBlockReferenceLabel(note, viewScope.block);
        if (label) {
            $el.append($("<small>")
                .toggleClass("block-reference-broken", label.isBroken)
                .append(
                    $("<span>").addClass("bx bx-paragraph"),
                    document.createTextNode(label.text)
                ));
        }
    }

    if (viewScope?.page) {
        $el.append($("<small>").append(
            $("<span>").addClass(viewScope.annotation ? "bx bx-comment-detail" : "bx bx-file"),
            document.createTextNode(getPdfReferenceLabel(viewScope.page, viewScope.annotation))
        ));
    }

    if (viewScope?.columnTitle) {
        $el.append($("<small>")
            .addClass(cssClassManager.createClassForColor(viewScope.columnColor ?? null))
            .append(
                $("<span>").addClass(viewScope.columnIcon || DEFAULT_COLUMN_REFERENCE_ICON),
                document.createTextNode(` ${viewScope.columnTitle}`)
            ));
    }

    const icon = await getLinkIcon(note.noteId, viewScope?.viewMode);
    if (icon) {
        $el.prepend($("<span>").addClass(icon));
    }
}

async function getReferenceLinkTitle(href: string) {
    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        return MISSING_NOTE_TITLE;
    }

    // A card reference is titled by the card, not by the board in its path.
    const note = await froca.getNote(viewScope?.card || noteId);
    if (!note) {
        return MISSING_NOTE_TITLE;
    }

    if (viewScope?.viewMode === "attachments" && viewScope?.attachmentId) {
        // `froca.getAttachmentOfNote()` reloads the attachments when the cached list lacks it.
        const attachment = await froca.getAttachmentOfNote(noteId, viewScope.attachmentId);

        return attachment ? attachment.title : "[missing attachment]";
    }

    return note.title;
}

/**
 * The label of the reference link to `href`, from the notes already in froca. A link to a note that
 * is not there gets `storedTitle`, the title the content holds for it. A link to blocks of
 * `content`, the content the link is in, gets their text. When `isExcerpt`, `content` holds only
 * some blocks of the note, and the others are read from the saved note.
 */
function getReferenceLinkTitleSync(
    href: string, storedTitle?: string, content?: ParentNode | null, isExcerpt = false
) {
    const { noteId, viewScope } = parseNavigationStateFromUrl(href);
    if (!noteId) {
        return storedTitle || MISSING_NOTE_TITLE;
    }

    const note = froca.getNoteFromCache(viewScope?.card || noteId);
    if (content && viewScope?.block) {
        const label = getBlockReferenceLabel(content, viewScope.block);
        const savedLabel = label.isBroken && isExcerpt && note
            ? getCachedBlockReferenceLabel(note, viewScope.block)
            : null;
        return (savedLabel ?? label).text;
    }

    if (!note) {
        return storedTitle || MISSING_NOTE_TITLE;
    }

    if (viewScope?.viewMode === "attachments" && viewScope?.attachmentId) {
        if (!note.attachments) {
            return "[loading title...]";
        }

        const attachment = note.attachments.find((att) => att.attachmentId === viewScope.attachmentId);

        return attachment ? attachment.title : "[missing attachment]";
    }

    if (viewScope?.columnTitle) {
        return `${note.title}: ${viewScope.columnTitle}`;
    }

    if (viewScope?.bookmark) {
        return `${note.title} - ${viewScope.bookmark}`;
    }

    const blockLabel = viewScope?.block
        ? getCachedBlockReferenceLabel(note, viewScope.block)
        : null;
    if (blockLabel && !blockLabel.isBroken) {
        return `${note.title} - ${blockLabel.text}`;
    }

    if (viewScope?.page) {
        return `${note.title} - ${getPdfReferenceLabel(viewScope.page, viewScope.annotation)}`;
    }

    return note.title;
}

/** What a reference to a PDF says after the title: the page, or the annotation on it. */
function getPdfReferenceLabel(pageNumber: string, annotation: string | undefined) {
    return t(annotation ? "pdf.annotation_reference" : "pdf.page_reference", { pageNumber });
}

/**
 * Opens notes from the links of the app: a click, middle click or double click on an `<a>` goes
 * through {@link goToLink}, a right-click opens the link menu. An entry that shows notes calls it
 * once at startup. A shared page hosting an app view keeps its links as plain links to other shared
 * pages, and a printed note keeps them as they are.
 */
export function setupLinkHandlers() {
    if (glob.device === "print" || isShare) {
        return;
    }

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

    // Captured at the window, before any widget can stop the key on its way to the editor.
    for (const type of [ "keydown", "keyup" ] as const) {
        window.addEventListener(type, (e) => setFollowLinkKeyHeld(!!utils.isCtrlKey(e)), true);
    }
    window.addEventListener("blur", () => setFollowLinkKeyHeld(false));

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

export { calculateExtraWindowUrl, calculateHash, parseNavigationStateFromUrl } from "./navigation_state.js";
export type { HashPane, ViewMode, ViewScope } from "./navigation_state.js";

export default {
    getNotePathFromUrl,
    createLink,
    goToLink,
    goToLinkExt,
    loadReferenceLinkTitle,
    getReferenceLinkTitle,
    getReferenceLinkTitleSync,
    calculateHash,
    calculateExtraWindowUrl,
    getBlockJump,
    parseNavigationStateFromUrl
};
