import type { CKTextEditor } from "@triliumnext/ckeditor5";
import {
    formatBlockRange, parseBlockRange, resolveBlockRange, resolveBlockReference
} from "@triliumnext/commons";

import type { CommandNames } from "../components/app_context.js";
import contextMenu, { type MenuItem } from "../menus/context_menu.js";
import type { ClipboardAccess } from "../menus/table_context_menu.js";
import { getTextEditorContaining } from "../menus/text_editor_context_menu.js";
import { getBlockExcerpt } from "./block_excerpts.js";
import { copyHtmlWithToast } from "./clipboard_ext.js";
import { expandAncestorDetails } from "./collapsible.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import { calculateHash, parseNavigationStateFromUrl, type ViewScope } from "./link.js";
import toast from "./toast.js";

const FLASH_CLASS = "block-reference-flash";
/** The duration of the `block-reference-flash` animation in `block_reference.css`. */
const FLASH_DURATION_MS = 1500;
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
    /** Pastes the reference on the clipboard, in the _Paste_ submenu. */
    paste: MenuItem<CommandNames>[];
}

/** The component of a text editor that copies references to the blocks of its note. */
interface BlockReferenceHost {
    copyBlockReference?(): Promise<void>;
}

/** Opens the menu of the block handle at `event`, which copies a reference to `count` blocks. */
export function openBlockHandleMenu(event: MouseEvent, count: number, copyReference: () => void) {
    void contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ getCopyItem(count, copyReference) ],
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
    const target = editor.execute("assignBlockReference");
    const root = editor.editing.view.getDomRoot();
    const { start, end } = target && root
        ? resolveBlockRange<HTMLElement>(root, target)
        : { start: null, end: null };
    if (!target || !start || !end) {
        return;
    }

    flashBlocks(getBlockRangeElements(start, end));
    const href = calculateHash({ notePath, viewScope: { block: formatBlockRange(target) } });
    const $link = $("<a>")
        .addClass("reference-link")
        .attr("href", href)
        .text(`${noteTitle} - ${getBlockExcerpt(start, end)}`);
    await copyHtmlWithToast($link[0].outerHTML, href);
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

    const { start, end } = resolveBlockReference<HTMLElement>(container, viewScope.block);
    viewScope.block = undefined;

    const first = start ?? end;
    if (first) {
        expandAncestorDetails(first);
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        flashBlocks(start && end ? getBlockRangeElements(start, end) : [ first ]);
    }
    if (!start || !end) {
        toast.showError(t("block_reference.not_found"));
    }
}

/**
 * Highlights the blocks that `value`, a `block` link parameter, points at in `container`, and opens
 * the collapsed blocks around its first and last block. Of a broken range, the block found is
 * highlighted.
 */
export function highlightBlockReference(container: HTMLElement, value: string) {
    const { start, end } = resolveBlockReference<HTMLElement>(container, value);
    const first = start ?? end;
    if (!first) {
        return;
    }

    for (const block of [ start, end ]) {
        if (block) {
            expandAncestorDetails(block);
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

    const top = first.getBoundingClientRect().top;
    const height = last.getBoundingClientRect().bottom - top;
    const viewportTop = container.getBoundingClientRect().top + container.clientTop;
    const margin = Math.max(0, (container.clientHeight - height) / 2);
    container.scrollTop += top - viewportTop - margin;
}

/** The outermost elements inside the range from `start` to `end`, both included. */
export function getBlockRangeElements(start: Element, end: Element) {
    const range = start.ownerDocument.createRange();
    range.setStartBefore(start);
    range.setEndAfter(end);
    return getElementsInRange(range, range.commonAncestorContainer);
}

function getElementsInRange(range: Range, parent: Node): Element[] {
    const elements: Element[] = [];
    for (const child of Array.from(parent.childNodes)) {
        if (!(child instanceof Element) || !range.intersectsNode(child)) {
            continue;
        }

        if (isInRange(range, child)) {
            elements.push(child);
        } else {
            elements.push(...getElementsInRange(range, child));
        }
    }

    return elements;
}

function isInRange(range: Range, node: Node) {
    const nodeRange = range.cloneRange();
    nodeRange.selectNode(node);
    return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
        && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0;
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
    const root = editor.editing.view.getDomRoot();
    const host: BlockReferenceHost | undefined = root && glob.getComponentByEl(root);
    if (!command?.isEnabled || !host?.copyBlockReference) {
        return null;
    }

    return getCopyItem(command.value, () => void host.copyBlockReference?.());
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

function flashBlocks(elements: Element[]) {
    for (const element of elements) {
        element.classList.add(FLASH_CLASS);
        setTimeout(() => element.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
    }
}
