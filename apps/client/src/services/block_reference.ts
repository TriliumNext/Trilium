import type { CKTextEditor, EditorConfig } from "@triliumnext/ckeditor5";
import {
    flashBlocks, getBlockBoxes, getBlockRangeElements, showBlockReference
} from "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js";
import {
    type BlockRange, encodeBlockParameter, formatBlockRange, parseBlockRange, resolveBlockRange,
    resolveBlockReference
} from "@triliumnext/commons";

import type { CommandNames } from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import contextMenu, { type MenuItem } from "../menus/context_menu.js";
import type { ClipboardAccess } from "../menus/table_context_menu.js";
import {
    buildSortSelectionMenuItem, getTextEditorContaining
} from "../menus/text_editor_context_menu.js";
import { getBlockExcerpt } from "./block_excerpts.js";
import { copyHtmlWithToast, copyTextWithToast } from "./clipboard_ext.js";
import { revealElement } from "./collapsible.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
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
    /** Copies a reference to the selected blocks. */
    copyReference: () => void;
    /** Copies a link to the selected blocks on the shared page of the note, if it is shared. */
    copyShareLink?: () => void;
    /** The _Sort_ submenu, shown last. */
    sortItem?: MenuItem<CommandNames> | null;
}

/** The note a text editor is open on, which the references it copies point to. */
export interface ReferenceSource {
    getEditor(): CKTextEditor | null | undefined;
    getNote(): FNote | null | undefined;
    /** The path the note is open at, if known. */
    getNotePath(): string | null | undefined;
    /** Saves the note now, so that a copied link resolves at once. */
    save(): unknown;
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
            openHandleMenu(event, count) {
                const note = source.getNote();
                const shareLink = note && getNoteShareLink(note);
                openBlockHandleMenu(event, count, {
                    copyReference: () => void copy(copyBlockReference),
                    copyShareLink: shareLink
                        ? () => void copy((editor) => copyBlockShareLink(editor, shareLink))
                        : undefined,
                    sortItem: buildSortSelectionMenuItem(source.getEditor())
                });
            },
            copyReference: () => void copy(copyBlockReference)
        },
        tabs: {
            copyReference: () => void copy(copyTabReference)
        }
    };
}

/** Opens the menu of the block handle at `event`, for `count` selected blocks. */
export function openBlockHandleMenu(
    event: MouseEvent,
    count: number,
    { copyReference, copyShareLink, sortItem }: BlockHandleMenuActions
) {
    const items = [ getCopyItem(count, copyReference) ];
    if (copyShareLink) {
        items.push({
            title: t("block_reference.copy_share_link", { count }),
            uiIcon: "bx bx-world",
            handler: copyShareLink
        });
    }
    if (sortItem) {
        items.push({ kind: "separator" }, sortItem);
    }

    void contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items,
        selectMenuItemHandler: () => {}
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

function getCopyItem(count: number, copyReference: () => void): MenuItem<CommandNames> {
    return {
        title: t("block_reference.copy", { count }),
        uiIcon: "bx bx-link",
        handler: copyReference
    };
}

function getCopyMenuItem(editor: CKTextEditor) {
    const command = editor.commands.get("assignBlockReference");
    const copyReference = editor.config.get("blockReference")?.copyReference;
    if (!command?.isEnabled || !copyReference) {
        return null;
    }

    return getCopyItem(command.value, () => copyReference());
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
    toHtml: (reference: ClipboardBlockReference) => string | Promise<string>
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

        target.paste(await toHtml(reference), reference.href);
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
async function getExcerptHtml({ noteId, block }: ClipboardBlockReference) {
    // Imported on demand: `content_renderer` imports `content_renderer_text`, which imports this
    // module.
    const { EXCERPT_BOX_SIZE } = await import("./content_renderer.js");
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
