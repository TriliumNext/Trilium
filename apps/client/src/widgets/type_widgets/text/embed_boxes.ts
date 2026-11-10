import {
    EXTENDED_CODE_BLOCK_CLASS, EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE, getEmbedKey,
    getLinkPreviewPlayer, getMediaEmbedClasses, getNoteEmbedHref, getVideoAspectRatio,
    INLINE_BOX_SIZES, normalizeEmbedBox, readLinkPreviewData, readMediaEmbedBox,
    VIDEO_ASPECT_RATIO_PROPERTY
} from "@triliumnext/commons";
import clsx from "clsx";

import {
    applyInlineMermaid, emptyUnknownEmbeds, loadReferenceLink, replaceWithEmbedBox,
    replaceWithReferenceLink, rewriteMermaidDiagramsInContainer
} from "../../../services/content_renderer_text";
import { getSourceEmbedTypeByLanguage } from "../../../services/source_embeds";
import {
    getAttachmentHref, loadEmbeddedAttachment, loadEmbeddedNote, loadInlineEmbed, loadMediaEmbed,
    loadUnknownEmbed
} from "./utils";

/** Where the embeds that {@link prepareEmbedBoxes} shows sit. */
export interface EmbedBoxContext {
    /**
     * The notes and blocks shown around the embeds, by `getEmbedKey()`. An embed of one of them
     * becomes a reference link to it, so that notes that include each other stop there.
     */
    seenNoteIds: ReadonlySet<string>;
    /** The note whose content holds the embeds. The content of their boxes links to it as well. */
    hostNoteId?: string;
    /** Whether the content changes as it is typed, see {@link hasSourceEmbedBoxes}. */
    isChanging?: boolean;
}

/**
 * Replaces the embeds in `container`, rendered text, with the read-only boxes that the editor
 * shows them in, and returns the call that fills the boxes: included notes and attachments,
 * embeds of a kind that this version does not know and, while {@link hasSourceEmbedBoxes},
 * diagrams, extended code blocks and media. Otherwise diagrams draw in place. An embed of a
 * note or attachment in `context.seenNoteIds` becomes a reference link to it instead. While
 * `isNested`, `container` is the content of another box, out of the page, and its notes and
 * attachments show as Compact boxes, a title row without their content.
 *
 * The passes over the rest of the content run before the call, so that they leave the content
 * of the boxes alone.
 */
export function prepareEmbedBoxes(
    container: HTMLElement,
    context: EmbedBoxContext,
    isNested = false
): () => Promise<unknown> {
    const loads: (() => Promise<unknown>)[] = [];
    // First, so that no other pass renders the content of these embeds.
    for (const box of emptyUnknownEmbeds(container)) {
        loads.push(() => loadUnknownEmbed(box, box.dataset.boxSize));
    }
    if (hasSourceEmbedBoxes(context.isChanging)) {
        loads.push(...prepareSourceEmbeds(container, isNested), ...prepareMediaEmbeds(container));
    } else {
        rewriteMermaidDiagramsInContainer(container);
        // First, as it reads the source of each diagram from the content, before the boxes fill.
        loads.unshift(() => applyInlineMermaid(container));
    }
    loads.push(...prepareContentEmbeds(container, context, isNested));
    return () => Promise.all(loads.map((load) => load()));
}

/**
 * Whether rendered text shows its diagrams, extended code blocks and media in embed boxes, unless
 * it changes as it is typed (`isChanging`), as a box would remount on every change.
 */
export function hasSourceEmbedBoxes(isChanging = false) {
    // Printing snapshots the page, before an embed box would have drawn its diagram.
    return !isChanging && glob.device !== "print";
}

/**
 * Returns the calls that fill the box of each included note and attachment in `container`, or
 * that replace the embed with a reference link to a note or attachment shown around it.
 */
function prepareContentEmbeds(
    container: HTMLElement,
    { seenNoteIds, hostNoteId }: EmbedBoxContext,
    isNested: boolean
) {
    const shownNoteIds = hostNoteId ? new Set(seenNoteIds).add(hostNoteId) : seenNoteIds;
    const loads: (() => Promise<unknown>)[] = [];
    for (const embed of container.querySelectorAll<HTMLElement>(".include-note")) {
        normalizeEmbedBox(embed);
        const { attachmentId, noteId, block } = embed.dataset;
        const id = attachmentId || noteId;
        if (!id) continue;
        // Each box would render the embeds of its own content, so a few levels of notes that
        // include the same notes render the same content many times over.
        if (isNested) {
            embed.dataset.boxSize = "compact";
        }

        if (seenNoteIds.has(getEmbedKey(id, block))) {
            loads.push(async () => {
                const href = attachmentId
                    ? await getAttachmentHref(attachmentId)
                    : getNoteEmbedHref(id, block);
                if (href) {
                    await loadReferenceLink(replaceWithReferenceLink(embed, href), hostNoteId);
                }
            });
        } else if (attachmentId) {
            loads.push(() => loadEmbeddedAttachment(attachmentId, $(embed), undefined, {
                seenNoteIds: shownNoteIds, isNested
            }));
        } else {
            loads.push(() => loadEmbeddedNote(id, $(embed), undefined, {
                block, seenNoteIds: shownNoteIds, isNested
            }));
        }
    }
    return loads;
}

/**
 * Replaces each link preview in `container` that plays media with the embed box the editor shows
 * it in, and returns the calls that fill the boxes, with their title row and caption, and without
 * the menu of the editor.
 */
function prepareMediaEmbeds(container: HTMLElement) {
    const loads: (() => Promise<void>)[] = [];
    for (const section of container.querySelectorAll<HTMLElement>("section.link-embed")) {
        const getAttribute = (name: string) => section.getAttribute(name);
        const preview = readLinkPreviewData(getAttribute);
        const player = preview && getLinkPreviewPlayer(preview);
        if (!preview || !player) continue;

        const figure = document.createElement("figure");
        figure.classList.add("include-note", ...getMediaEmbedClasses(player.type === "audio"));
        const { boxSize, isTitleHidden } = readMediaEmbedBox(getAttribute, player);
        figure.dataset.boxSize = boxSize;
        if (isTitleHidden) {
            figure.dataset.hideTitle = "true";
        }
        const { position, triliumBlockId } = section.dataset;
        for (const [ name, value ] of Object.entries({ position, triliumBlockId })) {
            if (value) {
                figure.dataset[name] = value;
            }
        }
        const style = section.getAttribute("style");
        if (style) {
            figure.setAttribute("style", style);
        }
        const aspectRatio = player.type !== "audio" && getVideoAspectRatio(preview);
        if (aspectRatio) {
            figure.style.setProperty(VIDEO_ASPECT_RATIO_PROPERTY, String(aspectRatio));
        }
        replaceWithEmbedBox(section, figure);
        loads.push(() => loadMediaEmbed(preview, figure));
    }
    return loads;
}

/**
 * Replaces each code block in `container` that keeps the source of an embed, such as a Mermaid
 * diagram, with the embed box the editor shows it in, and returns the calls that fill the boxes,
 * read-only.
 */
function prepareSourceEmbeds(container: HTMLElement, isNested: boolean) {
    const loads: (() => Promise<void>)[] = [];
    for (const code of container.querySelectorAll<HTMLElement>("pre > code")) {
        const pre = code.parentElement;
        const codeLanguage = [ ...code.classList ]
            .find((name) => name.startsWith("language-"))?.slice("language-".length);
        const isDiagram = !!codeLanguage && !!getSourceEmbedTypeByLanguage(codeLanguage);
        const isCodeBlock = !isDiagram && !!pre?.classList.contains(EXTENDED_CODE_BLOCK_CLASS);
        if (!pre || (!isDiagram && !isCodeBlock)) continue;
        const language = codeLanguage ?? EXTENDED_CODE_BLOCK_DEFAULT_LANGUAGE;

        const figure = document.createElement("figure");
        figure.className = clsx("include-note", isCodeBlock && EXTENDED_CODE_BLOCK_CLASS);
        const {
            boxSize, displayMode, position, codeWrapLines, codeLineNumbers, codeTabWidth,
            codeIndentWithTabs
        } = pre.dataset;
        if (boxSize) {
            figure.dataset.boxSize = boxSize;
        }
        figure.dataset.language = language;
        const views = {
            displayMode, position, codeWrapLines, codeLineNumbers, codeTabWidth, codeIndentWithTabs
        };
        for (const [ name, value ] of Object.entries(views)) {
            if (value) {
                figure.dataset[name] = value;
            }
        }
        figure.dataset.hideTitle = "true";
        // Diagrams saved before the embed keep their block ID on the `<code>`.
        const blockId = pre.dataset.triliumBlockId ?? code.dataset.triliumBlockId;
        if (blockId) {
            figure.dataset.triliumBlockId = blockId;
        }
        const style = pre.getAttribute("style");
        if (style) {
            figure.setAttribute("style", style);
        }
        // A size saved by an older version reads as the size it became, at its height.
        const savedBoxSize = normalizeEmbedBox(figure);
        figure.dataset.boxSize = INLINE_BOX_SIZES.find((size) => size === savedBoxSize)
            ?? (isCodeBlock ? "full" : "resizable");
        pre.replaceWith(figure);

        const source = code.textContent;
        loads.push(() => loadInlineEmbed({
            language,
            getSource: () => source,
            setSource: () => {},
            subscribe: () => () => {},
            isReadOnly: () => true
        }, $(figure), figure.dataset.boxSize, { isFocused: false, isNested }));
    }
    return loads;
}
