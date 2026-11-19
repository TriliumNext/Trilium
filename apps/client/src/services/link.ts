import type { CachedTocResponse } from "@triliumnext/commons";
import {
    getContentScopes, resolveBlockReference
} from "@triliumnext/commons/src/lib/block_reference.js";
import { ALLOWED_PROTOCOLS } from "@triliumnext/commons/src/lib/shared_constants.js";

import appContext from "../components/app_context.js";
import { openInCurrentNoteContext } from "../components/note_context.js";
import type FNote from "../entities/fnote.js";
import {
    type BlockReferenceLabel, getBlockReferenceLabel, getCachedBlockReferenceLabel,
    loadBlockReferenceLabel
} from "./block_excerpts.js";
import cssClassManager from "./css_class_manager.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { getNoteImageUrl } from "./image_urls.js";
import {
    calculateExtraWindowUrl, calculateHash, parseNavigationStateFromUrl, type ViewMode, type ViewScope
} from "./navigation_state.js";
import server from "./server.js";
import { showError } from "./toast.js";
import treeService from "./tree.js";
import utils, { isShare } from "./utils.js";

/** The icon a column reference uses when the link carries no `columnIcon`. */
const DEFAULT_COLUMN_REFERENCE_ICON = "bx bx-columns";
const MISSING_NOTE_TITLE = "[missing note]";
/** How many documents the heading titles are kept for. */
const MAX_CACHED_TOCS = 20;
/**
 * The link parameters that the label of a reference link names, the most specific first, in the
 * order the views land on them: blocks before an anchor in a Markdown note, a heading before a
 * bookmark in a document preview and before the page in a PDF. The first with a label names it.
 */
export const LABELED_TARGET_PARAMS = [ "block", "heading", "bookmark", "page" ] as const;

/** The heading titles of each document by heading id, by its ToC route, with their blob. */
const headingTitles = new Map<string, { blobId: string; titles: Map<string, string> }>();
/** The reads of a ToC cache in flight, by ToC route and blob. */
const tocReads = new Map<string, Promise<CachedTocResponse | null>>();

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
    // The content of the note in the split, around the embeds that the link can be in.
    const page = $link.parents(".ck-content").last()[0];
    const ntxId = $link.closest("[data-ntx-id]").attr("data-ntx-id");
    if (!page || !ntxId || !noteId) {
        return null;
    }

    // The innermost scope that shows the note: the embed that holds the link, one around it, or
    // the note of the split.
    const pageNoteId = appContext.tabManager.getNoteContextById(ntxId).noteId;
    const scope = getContentScopes<Element>($link[0], page)
        .find((candidate) => (candidate.noteId ?? pageNoteId) === noteId);
    if (!scope) {
        return null;
    }

    // A broken range is left to the note context, which also shows the error.
    const { start, end } = resolveBlockReference<Element>(scope.root, block);
    if (!start || !end) {
        return null;
    }

    return {
        isHeading: start === end && /^H[1-6]$/.test(start.tagName),
        show: () => void loadBlockJump()
            .then(({ showBlockReference }) => showBlockReference(scope.root, block))
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

    /* v8 ignore next -- parseNavigationStateFromUrl() gives a view scope with every note ID */
    const targetLabel = viewScope ? await loadLinkTargetLabel(note, viewScope) : null;
    if (targetLabel) {
        $el.append($("<small>")
            .toggleClass("block-reference-broken", targetLabel.isBroken)
            .append(
                $("<span>").addClass(targetLabel.icon),
                document.createTextNode(targetLabel.text)
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

    /* v8 ignore next -- parseNavigationStateFromUrl() gives a view scope with every note ID */
    const targetLabel = viewScope ? getCachedLinkTargetLabel(note, viewScope) : null;
    // A broken reference names the note alone.
    return targetLabel && !targetLabel.isBroken
        ? `${note.title} - ${targetLabel.text}`
        : note.title;
}

/** What a reference link shows after the note title for the place in the note it points at. */
export interface LinkTargetLabel {
    text: string;
    /** The icon, with its `bx` prefix. */
    icon: string;
    /** Whether the blocks that the link points at are missing from the note. */
    isBroken: boolean;
}

type LabeledTargetParam = (typeof LABELED_TARGET_PARAMS)[number];

/**
 * The label of the place in `note`, or in its attachment, that `viewScope` points at: blocks, a
 * heading of a document, an anchor or a page of a PDF, the first of {@link LABELED_TARGET_PARAMS}
 * that has one. `null` for a link to the whole note.
 */
export async function loadLinkTargetLabel(note: FNote, viewScope: ViewScope) {
    for (const param of LABELED_TARGET_PARAMS) {
        const value = viewScope[param];
        const label = value ? await loadParamLabel(note, viewScope, param, value) : null;
        if (label) {
            return label;
        }
    }
    return null;
}

/**
 * {@link loadLinkTargetLabel} for a link to a note, from the content and the heading titles that
 * are loaded already.
 */
function getCachedLinkTargetLabel(note: FNote, viewScope: ViewScope) {
    for (const param of LABELED_TARGET_PARAMS) {
        const value = viewScope[param];
        const label = value ? getCachedParamLabel(note, viewScope, param, value) : null;
        if (label) {
            return label;
        }
    }
    return null;
}

/** The label of the link parameter `param` whose value is `value`, read from the saved note. */
async function loadParamLabel(
    note: FNote, viewScope: ViewScope, param: LabeledTargetParam, value: string
) {
    if (param === "block") {
        return toBlockLabel(await loadBlockReferenceLabel(note, value));
    }
    if (param === "heading") {
        return toHeadingLabel(await loadLinkedHeadingTitle(note, viewScope, value));
    }
    return getCachedParamLabel(note, viewScope, param, value);
}

/** The label of the link parameter `param` whose value is `value`, from what is loaded already. */
function getCachedParamLabel(
    note: FNote, viewScope: ViewScope, param: LabeledTargetParam, value: string
): LinkTargetLabel | null {
    switch (param) {
        case "block":
            return toBlockLabel(getCachedBlockReferenceLabel(note, value));
        case "heading":
            return toHeadingLabel(
                getCachedHeadingTitle(getTocUrl("notes", note.noteId), note.blobId, value));
        case "bookmark":
            return { text: value, icon: "bx bx-bookmark", isBroken: false };
        case "page": {
            const { annotation } = viewScope;
            return {
                text: t(annotation ? "pdf.annotation_reference" : "pdf.page_reference",
                    { pageNumber: value }),
                icon: annotation ? "bx bx-comment-detail" : "bx bx-file",
                isBroken: false
            };
        }
    }
}

function toBlockLabel(label: BlockReferenceLabel | null): LinkTargetLabel | null {
    return label && { text: label.text, icon: "bx bx-paragraph", isBroken: label.isBroken };
}

function toHeadingLabel(title: string | null): LinkTargetLabel | null {
    return title ? { text: title, icon: "bx bx-heading", isBroken: false } : null;
}

/** The ToC route of a note or an attachment, such as `notes/abc/toc`. */
export function getTocUrl(entityType: "notes" | "attachments", entityId: string) {
    return `${entityType}/${entityId}/toc`;
}

/**
 * Remembers the titles of the headings that the ToC cache of a document lists for its blob
 * `blobId`, so that the labels of links to them need no request. `tocUrl` is the ToC route of the
 * document, from {@link getTocUrl}.
 */
export function rememberHeadingTitles(
    tocUrl: string, blobId: string, headings: { id: string; title: string }[]
) {
    headingTitles.delete(tocUrl);
    if (headingTitles.size >= MAX_CACHED_TOCS) {
        const [ oldest ] = headingTitles.keys();
        headingTitles.delete(oldest);
    }
    const titles = new Map(headings.map(({ id, title }) => [ id, title ]));
    headingTitles.set(tocUrl, { blobId, titles });
}

/** The title of the heading `headingId` that is remembered for the blob `blobId`, if any. */
function getCachedHeadingTitle(tocUrl: string, blobId: string | undefined, headingId: string) {
    const cached = headingTitles.get(tocUrl);
    return cached && cached.blobId === blobId ? cached.titles.get(headingId) ?? null : null;
}

/**
 * The title of the heading `headingId` of `note`, or of its attachment that `viewScope` names.
 * `null` when the heading is not found.
 */
async function loadLinkedHeadingTitle(note: FNote, viewScope: ViewScope, headingId: string) {
    if (viewScope.viewMode === "attachments" && viewScope.attachmentId) {
        const attachment = await froca.getAttachmentOfNote(note.noteId, viewScope.attachmentId);
        const tocUrl = getTocUrl("attachments", viewScope.attachmentId);
        return attachment ? loadHeadingTitle(tocUrl, attachment.blobId, headingId) : null;
    }
    return loadHeadingTitle(getTocUrl("notes", note.noteId), note.blobId, headingId);
}

/**
 * The title of the heading `headingId` of the document whose ToC route is `tocUrl` and whose blob
 * is `blobId`, read from its ToC cache. The read never builds the cache. Only a cache of the
 * current blob is remembered; a stale one gives the title once.
 */
async function loadHeadingTitle(tocUrl: string, blobId: string | undefined, headingId: string) {
    const cached = headingTitles.get(tocUrl);
    if (cached && cached.blobId === blobId) {
        return cached.titles.get(headingId) ?? null;
    }

    const response = await readToc(tocUrl, blobId);
    if (response?.status === "ready") {
        rememberHeadingTitles(tocUrl, response.blobId, response.headings);
    }
    if (response?.status === "ready" || response?.status === "stale") {
        return response.headings.find(({ id }) => id === headingId)?.title ?? null;
    }
    return null;
}

/** The ToC cache at `tocUrl`, read once for the labels of a blob that wait for it together. */
function readToc(tocUrl: string, blobId: string | undefined) {
    const key = `${tocUrl}:${blobId}`;
    const pending = tocReads.get(key);
    if (pending) {
        return pending;
    }

    const read = server.get<CachedTocResponse>(tocUrl, undefined, false, {
        silentBadRequest: true, silentNotFound: true
    })
        .catch(() => null)
        .finally(() => tocReads.delete(key));
    tocReads.set(key, read);
    return read;
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
