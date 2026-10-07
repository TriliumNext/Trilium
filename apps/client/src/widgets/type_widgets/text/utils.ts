import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { attachmentIcon } from "@triliumnext/commons";
import { h, type JSX } from "preact";

import appContext from "../../../components/app_context";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer, {
    type AttachmentEditor, type NoteEditor
} from "../../../services/content_renderer";
import { getEmbedCaption } from "../../../services/content_renderer_text";
import froca from "../../../services/froca";
import link, { ViewScope } from "../../../services/link";
import utils from "../../../services/utils";
import { watchContentEmbedTools } from "./content_embed_tools";
import ContentEmbed, { getNoteActions, TinyContentEmbed } from "./ContentEmbed";

interface EmbeddedNoteOptions {
    /** Saves the changes that the content makes to the note, such as a code note. */
    noteEditor?: NoteEditor;
    /** The blocks of the note to show, a `block` link parameter. The whole note when left out. */
    block?: string;
    /** Points the embed at the blocks that its editor holds, once they change. */
    onBlockChange?: (block: string) => void;
}

/**
 * Fills an embed box with a note. Without a box size of its own, the box takes the one of its
 * embed.
 */
export async function loadEmbeddedNote(
    noteId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string,
    { noteEditor, block, onBlockChange }: EmbeddedNoteOptions = {}
) {
    const note = await froca.getNote(noteId);
    if (!note) return;

    const el = $el[0];
    const size = boxSize ?? getEmbedBoxSize(el);
    const viewScope: ViewScope | undefined = block ? { block } : undefined;
    if (size === "tiny") {
        const $link = await link.createLink(note.noteId, {
            showTooltip: false,
            showNotePath: true,
            viewScope
        });
        const box = h(TinyContentEmbed, {
            icon: note.getIcon(),
            title: $link[0],
            notePath: note.noteId,
            viewScope,
            actions: getNoteActions(note.noteId)
        });
        await mountEmbedBox(el, box);
        return;
    }

    const $link = await link.createLink(note.noteId, {
        showTooltip: false,
        showNoteIcon: true,
        viewScope
    });

    // The embed widget itself is the first level of embedding, so the embedded note's own
    // embeds are rendered as reference links rather than expanded (see embedsAsReferenceLinks).
    const { $renderedContent, type } = await content_renderer.getRenderedContent(note, {
        interactive: true,
        embedsAsReferenceLinks: true,
        mediaEnvironment: "embedded",
        noteEditor,
        block,
        onBlockChange
    });

    const box = h(ContentEmbed, {
        boxSize: size,
        title: $link[0],
        content: $renderedContent[0],
        contentType: type,
        notePath: note.noteId,
        viewScope
    });
    await mountEmbedBox(el, box, $renderedContent);
}

interface EmbeddedAttachmentOptions {
    /** Saves the changes that the content makes to the attachment, such as a canvas drawing. */
    attachmentEditor?: AttachmentEditor;
    /** Whether the content takes the focus once the box is mounted. */
    isFocused?: boolean;
}

/**
 * Fills an embed box with an embedded attachment, under a title linking to it. Without a box
 * size of its own, the box takes the one of its embed.
 */
export async function loadEmbeddedAttachment(
    attachmentId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string,
    { attachmentEditor, isFocused }: EmbeddedAttachmentOptions = {}
) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return;

    const el = $el[0];
    const size = boxSize ?? getEmbedBoxSize(el);
    const viewScope: ViewScope = { viewMode: "attachments", attachmentId };
    if (size === "tiny") {
        // `attachment_actions` is imported on demand: it imports the image compression dialog.
        const [ $link, { getDownloadAction, getOpenExternallyAction } ] = await Promise.all([
            link.createLink(attachment.ownerId, { showTooltip: false, viewScope }),
            import("../../../services/attachment_actions")
        ]);
        const box = h(TinyContentEmbed, {
            icon: attachmentIcon(attachment.role, attachment.mime),
            title: $link[0],
            description: utils.formatSize(attachment.contentLength),
            notePath: attachment.ownerId,
            viewScope,
            actions: [ getOpenExternallyAction(attachment), getDownloadAction(attachment) ]
        });
        await mountEmbedBox(el, box);
        return;
    }

    const $link = await link.createLink(attachment.ownerId, {
        showTooltip: false,
        showNoteIcon: true,
        viewScope
    });
    const { $renderedContent, type } = await content_renderer.getRenderedContent(
        attachment,
        { interactive: true, mediaEnvironment: "embedded", attachmentEditor }
    );

    const box = h(ContentEmbed, {
        boxSize: size,
        title: $link[0],
        content: $renderedContent[0],
        contentType: type,
        notePath: attachment.ownerId,
        viewScope,
        ...(isFocused ? { isFocusedOnMount: true } : {})
    });
    await mountEmbedBox(el, box, $renderedContent);
}

/**
 * Mounts `box` in the embed `el`. An embed that left the page while it loaded gets no box,
 * and `content` rendered for it is disposed: `watchContentEmbeds()` has already passed it.
 */
async function mountEmbedBox(el: HTMLElement, box: JSX.Element, content?: JQuery<HTMLElement>) {
    if (!el.isConnected) {
        if (content) {
            content_renderer.disposeInteractiveContent(content);
        }
        return;
    }

    await content_renderer.mountInteractiveWidget(box, getWrapper(el));
}

function getEmbedBoxSize(el: HTMLElement) {
    return el.closest<HTMLElement>(".include-note")?.dataset.boxSize;
}

/**
 * The element an embed box is mounted in: `el` when it is the `.include-note-wrapper` the
 * editor renders, otherwise the wrapper of the `.include-note`, reused or created ahead of the
 * caption.
 */
function getWrapper(el: HTMLElement) {
    if (el.classList.contains("include-note-wrapper")) {
        return el;
    }

    const existing = el.querySelector<HTMLElement>(":scope > .include-note-wrapper");
    if (existing) {
        return existing;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "include-note-wrapper";
    const caption = getEmbedCaption(el);
    el.replaceChildren(wrapper, ...(caption ? [ caption ] : []));
    return wrapper;
}

/**
 * Opens the context menu of the note or attachment that `embed` shows, below `anchor`. The menu
 * opens from the embed, so that the text editor that contains it stays focused.
 */
export async function openContentEmbedMenu(embed: HTMLElement, anchor: HTMLElement) {
    const { noteId, attachmentId, block } = embed.dataset;
    const origin = linkContextMenu.getOriginBelow(anchor, embed);

    if (attachmentId) {
        const attachment = await froca.getAttachment(attachmentId, true);
        if (attachment) {
            await linkContextMenu.openContextMenu(attachment.ownerId, origin, {
                viewMode: "attachments",
                attachmentId
            });
        }
    } else if (noteId) {
        await linkContextMenu.openContextMenu(noteId, origin, block ? { block } : {});
    }
}

/** The href of a reference link to the attachment, or `null` once it is deleted. */
export async function getAttachmentHref(attachmentId: string) {
    const attachment = await froca.getAttachment(attachmentId, true);
    if (!attachment) return null;

    return `#root/${attachment.ownerId}?viewMode=attachments&attachmentId=${attachmentId}`;
}

/**
 * Unmounts the embed boxes, and what they show, once they leave `container`, and updates `editor`,
 * if any, when their content adds buttons to the toolbar of its embed. The returned function
 * stops watching and unmounts the boxes still in it.
 */
export function watchContentEmbeds(container: HTMLElement, editor?: CKTextEditor) {
    const observer = new MutationObserver(disposeRemoved);
    observer.observe(container, { childList: true, subtree: true });
    // The toolbar of an embed reads the buttons of its content when the editor updates, so
    // content that adds them after its embed was selected has the editor update again.
    const stopWatchingTools = watchContentEmbedTools(container, () => editor?.ui.update());

    return () => {
        stopWatchingTools();
        disposeRemoved(observer.takeRecords());
        observer.disconnect();
        content_renderer.disposeInteractiveContent($(container));
    };
}

function disposeRemoved(records: MutationRecord[]) {
    for (const record of records) {
        for (const node of record.removedNodes) {
            // A node moved elsewhere in the document is still in use.
            if (node instanceof HTMLElement && !node.isConnected) {
                content_renderer.disposeInteractiveContent($(node));
            }
        }
    }
}

export function refreshEmbeddedNote(
    container: HTMLDivElement,
    noteId: string,
    options?: EmbeddedNoteOptions
) {
    const embeddedNotes =
        container.querySelectorAll<HTMLElement>(`.include-note[data-note-id="${noteId}"]`);
    for (const embeddedNote of embeddedNotes) {
        loadEmbeddedNote(noteId, $(embeddedNote), undefined, {
            ...options,
            block: embeddedNote.dataset.block
        });
    }
}

export function setupImageOpening(container: HTMLDivElement, singleClickOpens: boolean) {
    const $container = $(container);
    $container.on("dblclick", "img", (e) => openImageInCurrentTab($(e.target)));
    $container.on("click", "img", (e) => {
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
