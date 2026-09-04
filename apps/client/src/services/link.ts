import { ALLOWED_PROTOCOLS } from "@triliumnext/commons";

import appContext, { type NoteCommandData } from "../components/app_context.js";
import { openInCurrentNoteContext } from "../components/note_context.js";
import linkContextMenuService from "../menus/link_context_menu.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { showError } from "./toast.js";
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
    /**
     * If true, a text note is edited with the floating toolbar whatever the user's editor-type
     * option says — the toolbar following the selection rather than standing in a bar of its own.
     *
     * For views too narrow to carry a full toolbar, such as the geo map's marker pane: a classic bar
     * built for the width of a note either spills out of them or eats the room the note is left.
     */
    floatingToolbar?: boolean;
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
    /** When set, scrolls to a bookmark anchor within the note after navigation. */
    bookmark?: string;
    /** When set, scrolls to the block carrying this `data-block-id` after navigation. */
    blockId?: string;
}

/**
 * The state of a single split pane, as carried by the `splits` hash parameter when a tab is
 * moved or copied into a window of its own.
 */
export interface HashPane {
    notePath?: string | null;
    hoistedNoteId?: string | null;
    viewScope?: ViewScope;
}

/** A note path as it may appear in a hash: slash-separated note ids. */
const NOTE_PATH_PATTERN = /^[_a-z0-9]{4,}(\/[_a-z0-9]{4,})*$/i;

/**
 * How many extra panes a hash is allowed to carry. Well beyond any layout a user would build by
 * hand, but low enough that a hand-written address can't ask the app to open hundreds of panes.
 */
const MAX_SPLIT_PANES_IN_HASH = 8;

/** Hash parameters that belong to a pane's view scope rather than to the window as a whole. */
const VIEW_SCOPE_PARAMS = ["viewMode", "attachmentId", "bookmark", "blockId"];

/**
 * The CSS selector for the in-note element a view scope wants scrolled into view — a named anchor
 * (`?bookmark=`) or a block (`?blockId=`) — or `null` when it asks for neither.
 *
 * Consuming: the target is cleared as it is read, so a later re-render of the same note does not
 * yank the reader back to it. Callers should therefore only call this once they are ready to
 * scroll. Shared by the read-only and editable text views, which locate the element differently
 * (rendered content vs. the editor's DOM root) but agree on what to look for.
 */
export function takeScrollTargetSelector(viewScope: ViewScope | undefined): string | null {
    if (viewScope?.bookmark) {
        const selector = `[id="${CSS.escape(viewScope.bookmark)}"]`;
        viewScope.bookmark = undefined;
        return selector;
    }

    if (viewScope?.blockId) {
        const selector = `[data-block-id="${CSS.escape(viewScope.blockId)}"]`;
        viewScope.blockId = undefined;
        return selector;
    }

    return null;
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

export function calculateHash(
    { notePath, ntxId, hoistedNoteId, viewScope = {}, splits, activeSplit }: NoteCommandData
) {
    notePath = notePath || "";
    const params = [
        ntxId ? { ntxId } : null,
        hoistedNoteId && hoistedNoteId !== "root" ? { hoistedNoteId } : null,
        viewScope.viewMode && viewScope.viewMode !== "default" ? { viewMode: viewScope.viewMode } : null,
        viewScope.attachmentId ? { attachmentId: viewScope.attachmentId } : null,
        splits?.length ? { splits: splits.map(encodeSplitPane).join(",") } : null,
        splits?.length && activeSplit ? { activeSplit: String(activeSplit) } : null
    ].filter((p) => !!p);

    const paramStr = params
        .map((pair) => {
            const name = Object.keys(pair)[0];
            const value = (pair as Record<string, string | undefined>)[name];

            /* v8 ignore next -- `value` is never undefined: every retained pair holds a string. It
               can be empty, but only for a `splits` list whose panes are all empty. */
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

/**
 * Serializes one extra pane into an entry of the `splits` parameter: its own hash body, minus the
 * leading `#`. Entries are joined with commas, which is unambiguous because neither a note path nor
 * an encoded parameter value can contain one. A pane holding no note yields an empty entry, so that
 * the pane count of the original tab survives the trip.
 */
function encodeSplitPane(pane: HashPane) {
    return calculateHash(pane).slice(1);
}

/** The subset of `window.location` needed to build a URL, which a plain `URL` also satisfies. */
interface UrlParts {
    protocol: string;
    host: string;
    pathname: string;
    search: string;
}

/**
 * Builds the address of a detached ("extra") window showing the given target.
 *
 * The current query string is carried over rather than replaced. On the server it holds nothing of
 * interest, but in standalone the query *is* the environment (`?safeMode`, `?startNoteId` — see
 * `QUERY_TO_ENV` in the standalone platform provider), so a window that dropped it would boot with
 * different settings than the one it was opened from, and would apply those to every other window
 * should it later inherit the database lock.
 */
export function calculateExtraWindowUrl(target: NoteCommandData, location: UrlParts = window.location) {
    const params = new URLSearchParams(location.search);
    params.set("extraWindow", "1");

    return `${location.protocol}//${location.host}${location.pathname}?${params}${calculateHash(target)}`;
}

/** Whether the query string of `url` (everything before `hashIdx`) carries the `extraWindow` marker. */
function isExtraWindowUrl(url: string, hashIdx: number) {
    return /[?&]extraWindow(?:[=&]|$)/.test(url.slice(0, hashIdx));
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

    const isExtraWindow = isExtraWindowUrl(url, hashIdx);

    // Exclude external links that contain #
    if (hashIdx !== 0 && !url.includes("/#root") && !url.includes("/#?searchString") && !isExtraWindow) {
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
    let splits: HashPane[] | null = null;
    let activeSplit = 0;

    for (const [name, value] of parseHashParams(paramString)) {
        if (name === "ntxId") {
            ntxId = value;
        } else if (name === "hoistedNoteId") {
            hoistedNoteId = value;
        } else if (name === "searchString") {
            searchString = value; // supports triggering search from URL, e.g. #?searchString=blabla
        } else if (VIEW_SCOPE_PARAMS.includes(name)) {
            (viewScope as any)[name] = value;
        } else if (name === "popup") {
            openInPopup = true;
        } else if (name === "splits") {
            // Splits lay out the whole window, so they are honoured only while booting a
            // detached one. A link inside a note reaches this same parser, and no note should
            // be able to rearrange the panes of the window it is read in.
            splits = isExtraWindow ? parseSplitPanes(value) : null;
        } else if (name === "activeSplit") {
            activeSplit = Number.parseInt(value, 10) || 0;
        } else {
            console.warn(`Unrecognized hash parameter '${name}'.`);
        }
    }

    if (searchString) {
        return { searchString };
    }

    // A hash carrying splits is one we wrote ourselves, so its main pane may hold no note —
    // that is how a tab whose first pane was empty keeps the rest of its panes.
    const isEmptyMainPaneWithSplits = !notePath && !!splits?.length;

    if (!isEmptyMainPaneWithSplits && !NOTE_PATH_PATTERN.test(notePath)) {
        return {};
    }

    return {
        notePath,
        noteId: treeService.getNoteIdFromUrl(notePath),
        ntxId,
        hoistedNoteId,
        viewScope,
        searchString,
        openInPopup,
        splits,
        activeSplit
    };
}

/** Iterates the `name=value` pairs of a hash's parameter string, decoding both sides. */
function parseHashParams(paramString: string | undefined) {
    if (!paramString) {
        return [];
    }

    return paramString.split("&").map((pair) => {
        const [name, value] = pair.split("=");

        return [decodeURIComponent(name), decodeURIComponent(value ?? "")] as const;
    });
}

/**
 * Parses the `splits` parameter — the panes that stood beside the main one, in order. Entries that
 * aren't a well-formed pane are dropped rather than failing the whole hash, so a mangled address
 * still opens what it can.
 */
function parseSplitPanes(value: string): HashPane[] {
    return value
        .split(",")
        .slice(0, MAX_SPLIT_PANES_IN_HASH)
        .map(parseSplitPane)
        .filter((pane) => !!pane);
}

function parseSplitPane(entry: string): HashPane | null {
    const [notePath, paramString] = entry.split("?");

    // An empty entry is a pane that held no note; anything else has to be a real note path.
    if (notePath && !NOTE_PATH_PATTERN.test(notePath)) {
        return null;
    }

    const pane: HashPane = {
        notePath: notePath || null,
        hoistedNoteId: null,
        viewScope: { viewMode: "default" }
    };

    for (const [name, paramValue] of parseHashParams(paramString)) {
        if (name === "hoistedNoteId") {
            pane.hoistedNoteId = paramValue;
        } else if (VIEW_SCOPE_PARAMS.includes(name)) {
            (pane.viewScope as any)[name] = paramValue;
        }
        // Everything else — `ntxId`, `searchString`, a nested `splits` — describes a window rather
        // than a pane, and has no meaning this far down.
    }

    return pane;
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
        const withinEditLink = $link?.hasClass("ck-link-actions__preview");
        const outsideOfCKEditor = !$link || $link.closest("[contenteditable]").length === 0;

        if (openInNewTab || openInNewWindow || (isLeftClick && (withinEditLink || outsideOfCKEditor))) {
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
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath, viewScope });
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
        // Warned about but not returned on. The editing downcast creates an empty <span> and this
        // call is the only thing that ever fills it, so bailing here left the widget rendering as
        // nothing at all while the stored HTML — which resolves its title through
        // getReferenceLinkTitleSync instead — said "[missing note]". An href that is not a hash
        // note URL is ordinary enough to reach: an attachment image URL, an external link, or
        // imported HTML carrying an <a class="reference-link">.
        console.warn("Missing note ID.");
    }

    const note = noteId ? await froca.getNote(noteId, true) : null;

    if (note) {
        $el.addClass(note.getColorClass());
    }

    const title = await getReferenceLinkTitle(href);
    $el.text(title);

    if (viewScope?.bookmark) {
        $el.append($("<small>").append(
            $("<span>").addClass("bx bx-bookmark"),
            document.createTextNode(viewScope.bookmark)
        ));
    }

    if (noteId && note) {
        const icon = await getLinkIcon(noteId, viewScope?.viewMode);

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

    if (viewScope?.bookmark) {
        return `${note.title} - ${viewScope.bookmark}`;
    }

    return note.title;
}

/* v8 ignore next -- the `print` device branch is evaluated once at module load; under test glob.device is undefined, so the false arm cannot be exercised */
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
    calculateExtraWindowUrl,
    parseNavigationStateFromUrl
};
