import type {
    CKTextEditor, EditorConfig, ModelElement, TriliumSlashCommands
} from "@triliumnext/ckeditor5";
import {
    flashBlocks, getBlockBoxes, getBlockRangeElements, showBlockReference
} from "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js";
import {
    type BlockRange, CANVAS_ATTACHMENT_MIME, encodeBlockParameter, EXCERPT_BOX_SIZE,
    formatBlockRange, MERMAID_ATTACHMENT_MIME, parseBlockRange, resolveBlockRange,
    resolveBlockReference
} from "@triliumnext/commons";

import type { CommandNames } from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import contextMenu, {
    type ContextMenuOptions, type MenuHeader, type MenuItem
} from "../menus/context_menu.js";
import type { ClipboardAccess } from "../menus/table_context_menu.js";
import {
    buildAiAssistantMenuItem, buildInsertMenuItems, buildSortSelectionMenuItem,
    getTextEditorContaining, keepEditorFocused
} from "../menus/text_editor_context_menu.js";
import { getBlockExcerpt } from "./block_excerpts.js";
import { copyHtml, copyHtmlWithToast, copyTextWithToast } from "./clipboard_ext.js";
import { revealElement } from "./collapsible.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { byBlockType } from "./in_app_help.js";
import { calculateHash, parseNavigationStateFromUrl, type ViewScope } from "./link.js";
import { getNoteShareLink } from "./share_link.js";
import toast from "./toast.js";

const HIGHLIGHT_CLASS = "block-reference-highlight";

/** A reference to blocks of a note, read from the clipboard. */
export interface ClipboardBlockReference {
    noteId: string;
    /** The `block` link parameter. */
    block: string;
    /** The href of a reference link to the blocks. */
    href: string;
}

/** The block reference rows of the text editor's right-click menu. */
export interface BlockReferenceMenuItems {
    /** Copies a reference to the selected blocks, in the _Copy_ submenu, or `null`. */
    copy: MenuItem<CommandNames> | null;
    /** Copies a link to the tab that holds the selection, in the _Copy_ submenu, or `null`. */
    copyTab: MenuItem<CommandNames> | null;
    /** Pastes the reference on the clipboard, in the _Paste_ submenu. */
    paste: MenuItem<CommandNames>[];
}

/** The actions of the block handle menu. */
export interface BlockHandleMenuActions {
    /** The items that insert blocks, list items or table rows, shown first, before a separator. */
    insertItems?: MenuItem<CommandNames>[];
    /** Puts the selected blocks on the clipboard and deletes them, first in the copy items. */
    cutBlocks?: () => void;
    /** Puts the selected blocks on the clipboard, before the reference items. */
    copyBlocks?: () => void;
    /** Copies a reference to the selected blocks. */
    copyReference: () => void;
    /** Copies a link to the selected blocks on the shared page of the note, if it is shared. */
    copyShareLink?: () => void;
    /** The _AI assistant_ submenu, after the copy items and a separator. */
    aiItem?: MenuItem<CommandNames> | null;
    /** The _Sort_ submenu, after a separator. */
    sortItem?: MenuItem<CommandNames> | null;
    /** Deletes the selected blocks, shown last, after a separator. */
    deleteBlocks?: () => void;
    /** Opens an in-app help page, by its ID without `_help_`, from the button of the heading. */
    openHelpPage?: (helpPage: string) => void;
}

/** The note a text editor is open on, which the references it copies point to. */
export interface ReferenceSource {
    getEditor(): CKTextEditor | null | undefined;
    getNote(): FNote | null | undefined;
    /** The path the note is open at, if known. */
    getNotePath(): string | null | undefined;
    /** Saves the note now, so that a copied link resolves at once. */
    save(): unknown;
    /**
     * Opens an in-app help page, by its ID without `_help_`, where the note context of the editor
     * can show it.
     */
    openHelpPage?: (helpPage: string) => void;
}

type CopyReference = (editor: CKTextEditor, notePath: string, noteTitle: string) => unknown;

/** The `blockReference` and `tabs` editor config, which copy references into `source`. */
export function buildReferenceConfig(
    source: ReferenceSource
): Pick<EditorConfig, "blockReference" | "tabs"> {
    async function copy(copyTo: CopyReference) {
        const editor = source.getEditor();
        const note = source.getNote();
        if (!editor || !note) {
            return;
        }

        await copyTo(editor, source.getNotePath() ?? `root/${note.noteId}`, note.title);
        await source.save();
    }

    return {
        blockReference: {
            openHandleMenu(origin, blocks, onClose) {
                const editor = source.getEditor();
                const note = source.getNote();
                const shareLink = note && getNoteShareLink(note);
                openBlockHandleMenu(origin, blocks, {
                    insertItems: buildInsertItems(editor, blocks),
                    ...getClipboardActions(editor),
                    copyReference: () => void copy(copyBlockReference),
                    copyShareLink: shareLink
                        ? () => void copy((target) => copyBlockShareLink(target, shareLink))
                        : undefined,
                    aiItem: buildAiAssistantMenuItem(editor, "cke cke-trilium-ai", blocks),
                    sortItem: buildSortSelectionMenuItem(editor),
                    deleteBlocks: getDeleteBlocksAction(editor),
                    openHelpPage: source.openHelpPage
                }, editor, onClose);
            },
            copyReference: () => void copy(copyBlockReference)
        },
        tabs: {
            copyReference: () => void copy(copyTabReference)
        }
    };
}

/**
 * Opens the menu of the block handle at the pointer of the right click `origin`, or below the
 * clicked handle `origin`, headed by the type of `blocks`, the blocks that the handle drags, and
 * calls `onClose` once the menu is closed. `editor` stays focused while the menu is up, so that its
 * handle stays shown.
 */
export function openBlockHandleMenu(
    origin: MouseEvent | HTMLElement,
    blocks: readonly ModelElement[],
    {
        insertItems, cutBlocks, copyBlocks, copyReference, copyShareLink, aiItem, sortItem,
        deleteBlocks, openHelpPage
    }: BlockHandleMenuActions,
    editor?: CKTextEditor | null,
    onClose?: () => void
) {
    // A click on the handle of the open menu only closes the menu.
    if (origin instanceof HTMLElement && contextMenu.dismissedByLastPress) {
        onClose?.();
        return;
    }

    const items: MenuItem<CommandNames>[] = [ getBlocksHeader(blocks, openHelpPage) ];
    if (insertItems?.length) {
        items.push(...insertItems, { kind: "separator" });
    }
    if (cutBlocks) {
        items.push({ title: t("block_handle_menu.cut"), uiIcon: "bx bx-cut", handler: cutBlocks });
    }
    if (copyBlocks) {
        items.push({
            title: t("block_handle_menu.copy"),
            uiIcon: "bx bx-copy",
            handler: copyBlocks
        });
    }
    items.push({
        title: t("block_reference.copy_reference"),
        uiIcon: "bx bx-link",
        handler: copyReference
    });
    if (copyShareLink) {
        items.push({
            title: t("block_reference.copy_share_link"),
            uiIcon: "bx bx-world",
            handler: copyShareLink
        });
    }
    if (aiItem) {
        items.push({ kind: "separator" }, aiItem);
    }
    if (sortItem) {
        items.push({ kind: "separator" }, sortItem);
    }
    if (deleteBlocks) {
        items.push({ kind: "separator" }, {
            title: t("block_handle_menu.delete"),
            uiIcon: "bx bx-trash destructive-action-icon",
            handler: deleteBlocks
        });
    }

    const editorFocus: Pick<ContextMenuOptions<CommandNames>, "onShow" | "onHide"> = editor
        ? keepEditorFocused(editor)
        : {};
    void contextMenu.show({
        ...(origin instanceof HTMLElement
            ? { anchor: origin }
            : { x: origin.pageX, y: origin.pageY }),
        items,
        selectMenuItemHandler: () => {},
        onShow: editorFocus.onShow,
        onHide: () => {
            editorFocus.onHide?.();
            onClose?.();
        }
    });
}

/**
 * The block reference rows for a right-click on `element`, or `null` when `element` is not in a
 * text editor. `clipboard` enables the paste rows.
 */
export async function buildBlockReferenceMenuItems(
    element: Element | null | undefined,
    clipboard?: ClipboardAccess
): Promise<BlockReferenceMenuItems | null> {
    const editor = await getTextEditorContaining(element);
    if (!editor?.plugins.has("BlockReference")) {
        return null;
    }

    return {
        copy: getCopyMenuItem(editor),
        copyTab: getCopyTabMenuItem(editor),
        paste: clipboard ? getPasteMenuItems(editor, clipboard) : []
    };
}

/**
 * The first link to blocks of a note in the HTML of the clipboard, else its text as such a link,
 * or `null`.
 */
export function getClipboardBlockReference(
    { html, text }: { html: string; text: string }
): ClipboardBlockReference | null {
    const links = html
        ? new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]")
        : [];
    const hrefs = Array.from(links, (link) => link.getAttribute("href") ?? "");

    for (const href of [ ...hrefs, text ]) {
        const reference = parseBlockReferenceHref(href);
        if (reference) {
            return reference;
        }
    }

    return null;
}

/**
 * Gives ids to the selected blocks of `editor`, flashes the blocks and copies a reference link to
 * them. `notePath` and `noteTitle` are of the note the editor shows.
 */
export async function copyBlockReference(
    editor: CKTextEditor,
    notePath: string,
    noteTitle: string
) {
    await copyReference(editor, editor.execute("assignBlockReference"), notePath, noteTitle);
}

/**
 * Gives an id to the tab that holds the selection of `editor`, flashes the tab and copies a link
 * to it, named by its title. `notePath` and `noteTitle` are of the note the editor shows.
 */
export async function copyTabReference(
    editor: CKTextEditor,
    notePath: string,
    noteTitle: string
) {
    await copyReference(editor, editor.execute("assignTabReference"), notePath, noteTitle);
}

/**
 * Gives ids to the selected blocks of `editor`, flashes the blocks and copies a link to them on
 * the shared page of the note, whose URL is `shareLink`.
 */
export function copyBlockShareLink(editor: CKTextEditor, shareLink: string) {
    const target = editor.execute("assignBlockReference");
    if (!target || !flashBlockRange(editor, target)) {
        return;
    }

    copyTextWithToast(`${shareLink}?block=${encodeBlockParameter(formatBlockRange(target))}`);
}

/** Flashes the blocks of `target` and copies a reference link to them. */
async function copyReference(
    editor: CKTextEditor,
    target: BlockRange | null | undefined,
    notePath: string,
    noteTitle: string
) {
    const blocks = target && flashBlockRange(editor, target);
    if (!target || !blocks) {
        return;
    }

    const href = calculateHash({ notePath, viewScope: { block: formatBlockRange(target) } });
    const $link = $("<a>")
        .addClass("reference-link")
        .attr("href", href)
        .text(`${noteTitle} - ${getBlockExcerpt(blocks.start, blocks.end)}`);
    await copyHtmlWithToast($link[0].outerHTML, href);
}

/**
 * Flashes the blocks of `target` in `editor`. Returns the first and the last block, or `null` when
 * one of them is not found.
 */
function flashBlockRange(editor: CKTextEditor, target: BlockRange) {
    const root = editor.editing.view.getDomRoot();
    const { start, end } = root
        ? resolveBlockRange<HTMLElement>(root, target)
        : { start: null, end: null };
    if (!start || !end) {
        return null;
    }

    flashBlocks(getBlockRangeElements(start, end));
    return { start, end };
}

/**
 * Reads and clears `viewScope.block`, then scrolls to the blocks it points at in `container` and
 * flashes them. When a block is missing, the blocks found are shown, with an error toast.
 */
export function consumeBlockReference(
    container: HTMLElement | null | undefined,
    viewScope: ViewScope | null | undefined
) {
    if (!viewScope?.block || !container) {
        return;
    }

    const isFound = showBlockReference(container, viewScope.block);
    viewScope.block = undefined;
    if (!isFound) {
        toast.showError(t("block_reference.not_found"));
    }
}

/**
 * Highlights the blocks that `value`, a `block` link parameter, points at in `container`, and
 * reveals its first and last block inside collapsed blocks and inactive tabs. Of a broken range,
 * the block found is highlighted.
 */
export function highlightBlockReference(container: HTMLElement, value: string) {
    const { start, end } = resolveBlockReference<HTMLElement>(container, value);
    const first = start ?? end;
    if (!first) {
        return;
    }

    for (const block of [ start, end ]) {
        if (block) {
            revealElement(block);
        }
    }
    const elements = start && end ? getBlockRangeElements(start, end) : [ first ];
    for (const element of elements) {
        element.classList.add(HIGHLIGHT_CLASS);
    }
}

/** Scrolls `container` to center its highlighted blocks, or to their top if they do not fit. */
export function revealHighlightedBlocks(container: HTMLElement) {
    const blocks = Array.from(container.querySelectorAll(`.${HIGHLIGHT_CLASS}`));
    const first = blocks.at(0);
    const last = blocks.at(-1);
    if (!first || !last) {
        return;
    }

    const top = getBlockBoxes(first).top.getBoundingClientRect().top;
    const height = getBlockBoxes(last).bottom.getBoundingClientRect().bottom - top;
    const viewportTop = container.getBoundingClientRect().top + container.clientTop;
    const margin = Math.max(0, (container.clientHeight - height) / 2);
    container.scrollTop += top - viewportTop - margin;
}

/**
 * The heading of the menu for `blocks`: the type of the only block, such as _Table_, with a button
 * that opens the help page of the type through `openHelpPage`, else the number of blocks.
 */
function getBlocksHeader(
    blocks: readonly ModelElement[],
    openHelpPage: ((helpPage: string) => void) | undefined
): MenuHeader {
    const block = blocks.length === 1 ? blocks[0] : undefined;
    if (!block) {
        const title = t("block_handle_menu.block_count", { count: blocks.length });
        return { kind: "header", title };
    }

    const type = getBlockType(block);
    const header: MenuHeader = {
        kind: "header",
        title: type === "heading"
            ? t("block_handle_menu.types.heading", { level: block.name.slice("heading".length) })
            : t(`block_handle_menu.types.${type}`)
    };
    const helpPage = byBlockType[type];
    if (helpPage && openHelpPage) {
        header.actions = [ {
            icon: "bx bx-help-circle",
            caption: t("open-help-page"),
            callback: () => openHelpPage(helpPage)
        } ];
    }
    return header;
}

/** The type of `block`. */
function getBlockType(block: ModelElement): BlockType {
    if (/^heading\d$/.test(block.name)) {
        return "heading";
    }
    if (block.name === "paragraph" && block.hasAttribute("listItemId")) {
        return block.getAttribute("listType") === "todo" ? "todo_item" : "list_item";
    }
    if (block.name === "contentEmbed") {
        return getEmbedType(block);
    }

    return BLOCK_TYPES[block.name] ?? "block";
}

/** The type of the content embed `embed`. */
function getEmbedType(embed: ModelElement): BlockType {
    if (embed.hasAttribute("url")) {
        return embed.getAttribute("embedType") === "audio" ? "audio" : "video";
    }
    if (embed.hasAttribute("language")) {
        return embed.getAttribute("language") === "mermaid" ? "mermaid" : "code_block";
    }
    if (embed.hasAttribute("noteId")) {
        return embed.hasAttribute("block") ? "excerpt" : "included_note";
    }

    const attachmentId = embed.getAttribute("attachmentId");
    const mime = typeof attachmentId === "string" ? froca.attachments[attachmentId]?.mime : null;
    switch (mime) {
        case CANVAS_ATTACHMENT_MIME:
            return "drawing";
        case MERMAID_ATTACHMENT_MIME:
            return "mermaid";
        default:
            return "attachment";
    }
}

/** The type of block of each element that names a single type. */
const BLOCK_TYPES: Record<string, BlockType> = {
    paragraph: "paragraph",
    blockQuote: "block_quote",
    codeBlock: "code_block",
    table: "table",
    imageBlock: "image",
    horizontalLine: "horizontal_line",
    pageBreak: "page_break",
    aside: "admonition",
    details: "collapsible",
    tabs: "tabs",
    multicolumnLayout: "columns",
    "mathtex-display": "math",
    footnoteSection: "footnotes",
    footnoteItem: "footnote",
    footnoteContent: "footnote",
    linkEmbed: "link_preview",
    unknownContentEmbed: "embed"
};

/** A type of block, by its key under `block_handle_menu.types`. */
export type BlockType = "paragraph" | "heading" | "list_item" | "todo_item" | "block_quote"
    | "code_block" | "table" | "image" | "horizontal_line" | "page_break" | "admonition"
    | "collapsible" | "tabs" | "columns" | "math" | "footnotes" | "footnote" | "included_note"
    | "excerpt" | "attachment" | "drawing" | "mermaid" | "video" | "audio" | "link_preview"
    | "embed" | "block";

/** The commands of the insert items for a list item or a table cell. */
type InsertCommandName = "triliumInsertListItemAbove" | "triliumInsertListItemBelow"
    | "triliumInsertChildListItem" | "triliumInsertTableRowsAbove" | "triliumInsertTableRowsBelow";

/**
 * The insert items of the block handle menu for `blocks`. Beside a list item, they insert list
 * items, and elsewhere _Insert above_ and _Insert below_ open the `/` palette's entries that insert
 * or wrap content. In a table cell, the items that insert rows follow.
 */
function buildInsertItems(
    editor: CKTextEditor | null | undefined,
    blocks: readonly ModelElement[]
): MenuItem<CommandNames>[] {
    const first = blocks.at(0);
    const last = blocks.at(-1);
    if (!editor || !first || !last) {
        return [];
    }

    const insertBeside = getInsertBesideBuilder(editor);
    const command = (title: string, uiIcon: string, name: InsertCommandName) =>
        getInsertCommandItem(editor, title, uiIcon, name);
    const above = first.hasAttribute("listItemId")
        ? [ command(t("block_handle_menu.insert_item_above"), "bx bx-arrow-to-top",
            "triliumInsertListItemAbove") ]
        : [ insertBeside?.(t("block_handle_menu.insert_above"), "bx bx-arrow-to-top",
            first, "before") ];
    const below = last.hasAttribute("listItemId")
        ? [
            command(t("block_handle_menu.insert_item_below"), "bx bx-arrow-to-bottom",
                "triliumInsertListItemBelow"),
            command(t("block_handle_menu.insert_child_item"), "bx bx-subdirectory-right",
                "triliumInsertChildListItem")
        ]
        : [ insertBeside?.(t("block_handle_menu.insert_below"), "bx bx-arrow-to-bottom",
            last, "after") ];
    const rows = [
        command(t("table_context_menu.insert_rows_above"), "bx bx-horizontal-left bx-rotate-90",
            "triliumInsertTableRowsAbove"),
        command(t("table_context_menu.insert_rows_below"), "bx bx-horizontal-left bx-rotate-270",
            "triliumInsertTableRowsBelow")
    ];

    return [ ...above, ...below, ...rows ]
        .filter((item): item is MenuItem<CommandNames> => !!item);
}

/**
 * Builds the _Insert above_ and _Insert below_ submenus, which list the `/` palette's entries that
 * insert or wrap content and run the one picked in a new paragraph beside a block. It is `null`
 * without the palette or while `editor` cannot insert a paragraph.
 */
function getInsertBesideBuilder(editor: CKTextEditor) {
    if (!editor.plugins.has("TriliumSlashCommands")
        || !editor.commands.get("insertParagraph")?.isEnabled) {
        return null;
    }

    const palette = editor.plugins.get("TriliumSlashCommands") as TriliumSlashCommands;
    const definitions = palette.listAll();
    return (
        title: string, uiIcon: string, block: ModelElement, side: "before" | "after"
    ): MenuItem<CommandNames> => ({
        title,
        uiIcon,
        enabled: palette.canInsertBeside(block, side),
        filterable: true,
        submenuClassName: "slash-command-menu",
        items: buildInsertMenuItems<CommandNames>(definitions,
            (definition) => palette.runBeside(definition, block, side))
    });
}

/** A row that runs `name` in `editor`, or `null` while the command is disabled. */
function getInsertCommandItem(
    editor: CKTextEditor, title: string, uiIcon: string, name: InsertCommandName
): MenuItem<CommandNames> | null {
    if (!editor.commands.get(name)?.isEnabled) {
        return null;
    }

    return {
        title,
        uiIcon,
        handler: () => {
            editor.execute(name);
            editor.editing.view.focus();
            editor.editing.view.scrollToTheSelection();
        }
    };
}

/**
 * The actions that put the blocks of the handle on the clipboard, as a copy does, each `undefined`
 * while its command is disabled. Cutting deletes the blocks once the clipboard holds them.
 */
function getClipboardActions(
    editor: CKTextEditor | null | undefined
): Pick<BlockHandleMenuActions, "cutBlocks" | "copyBlocks"> {
    if (!editor?.commands.get("copyBlocks")?.isEnabled) {
        return {};
    }

    /** Copies the blocks and returns their range, or `undefined` if the copy failed. */
    const copy = async () => {
        const { html, text, range } = editor.execute("copyBlocks");
        const isCopied = await copyHtml(html, text);
        if (!isCopied) {
            toast.showError(t("clipboard.copy_failed"));
        }
        return isCopied ? range : undefined;
    };

    const deleteBlocks = getDeleteBlocksAction(editor);
    return {
        cutBlocks: deleteBlocks && (async () => {
            const { version } = editor.model.document;
            const range = await copy();
            // A change during the clipboard write leaves `range` pointing at other content.
            if (range && editor.model.document.version === version) {
                editor.execute("deleteBlocks", range);
                editor.editing.view.focus();
            }
        }),
        copyBlocks: () => void copy()
    };
}

/** Runs `deleteBlocks` in `editor` and focuses it, or `undefined` while the command is disabled. */
function getDeleteBlocksAction(editor: CKTextEditor | null | undefined) {
    if (!editor?.commands.get("deleteBlocks")?.isEnabled) {
        return undefined;
    }

    return () => {
        editor.execute("deleteBlocks");
        editor.editing.view.focus();
    };
}

function getCopyMenuItem(editor: CKTextEditor): MenuItem<CommandNames> | null {
    const command = editor.commands.get("assignBlockReference");
    const copyReference = editor.config.get("blockReference")?.copyReference;
    if (!command?.isEnabled || !copyReference) {
        return null;
    }

    return {
        title: t("block_reference.copy", { count: command.value }),
        uiIcon: "bx bx-link",
        handler: () => copyReference()
    };
}

function getCopyTabMenuItem(editor: CKTextEditor): MenuItem<CommandNames> | null {
    const command = editor.commands.get("assignTabReference");
    const copyReference = editor.config.get("tabs")?.copyReference;
    if (!command?.isEnabled || !copyReference) {
        return null;
    }

    return {
        title: t("block_reference.copy_tab"),
        uiIcon: "bx bx-link",
        handler: () => copyReference()
    };
}

function getPasteMenuItems(
    editor: CKTextEditor,
    clipboard: ClipboardAccess
): MenuItem<CommandNames>[] {
    const canEmbed = editor.commands.get("insertContentEmbed")?.isEnabled === true;
    return [
        {
            title: t("block_reference.paste_as_link"),
            uiIcon: "bx bx-link",
            enabled: clipboard.enabled,
            handler: () => void pasteBlockReference(editor, clipboard, getLinkHtml)
        },
        {
            title: t("block_reference.paste_as_excerpt"),
            uiIcon: "bx bx-window-alt",
            enabled: clipboard.enabled && canEmbed,
            handler: () => void pasteBlockReference(editor, clipboard, getExcerptHtml)
        }
    ];
}

/**
 * Reads the clipboard and pastes the HTML that `toHtml` makes of the block reference on it, at
 * the selection the menu was opened on. The selection is pinned before the read, which can wait
 * on a permission prompt. Pastes nothing for a reference to a note that `froca` cannot find, as
 * one copied from another Trilium instance.
 */
async function pasteBlockReference(
    editor: CKTextEditor,
    clipboard: ClipboardAccess,
    toHtml: (reference: ClipboardBlockReference) => string
) {
    const target = editor.capturePasteTarget();
    try {
        const reference = getClipboardBlockReference(await clipboard.read());
        if (!reference) {
            toast.showMessage(t("block_reference.no_reference_on_clipboard"), 3000,
                "bx bx-info-circle");
            return;
        }
        if (!await froca.getNote(reference.noteId, true)) {
            toast.showError(t("block_reference.not_found"));
            return;
        }

        target.paste(toHtml(reference), reference.href);
    } catch (error) {
        console.warn("Failed to paste a block reference:", error);
    } finally {
        target.release();
    }
}

function getLinkHtml({ href }: ClipboardBlockReference) {
    const link = document.createElement("a");
    link.className = "reference-link";
    link.setAttribute("href", href);
    link.textContent = href;
    return link.outerHTML;
}

/** The HTML of an embed of the referenced blocks. */
function getExcerptHtml({ noteId, block }: ClipboardBlockReference) {
    const embed = document.createElement("figure");
    embed.className = "include-note";
    embed.dataset.noteId = noteId;
    embed.dataset.block = block;
    embed.dataset.boxSize = EXCERPT_BOX_SIZE;
    return embed.outerHTML;
}

/** The note and the blocks that `href` links to, or `null` for a link to anything else. */
function parseBlockReferenceHref(href: string): ClipboardBlockReference | null {
    let state: ReturnType<typeof parseNavigationStateFromUrl>;
    try {
        state = parseNavigationStateFromUrl(href);
    } catch {
        // A malformed percent escape.
        return null;
    }

    const { notePath, noteId } = state;
    const block = state.viewScope?.block;
    if (!notePath || !noteId || !block || !parseBlockRange(block)) {
        return null;
    }

    return { noteId, block, href: calculateHash({ notePath, viewScope: { block } }) };
}
