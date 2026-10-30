import type { CKTextEditor, InlineEmbedSource } from "@triliumnext/ckeditor5";
import { attachmentIcon } from "@triliumnext/commons";
import { h, type JSX } from "preact";

import appContext from "../../../components/app_context";
import type FAttachment from "../../../entities/fattachment";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer, {
    type AttachmentEditor, CONTENT_RENDERERS, type NoteEditor
} from "../../../services/content_renderer";
import { getEmbedCaption, getEmbedCodeView } from "../../../services/content_renderer_text";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import link, { ViewScope } from "../../../services/link";
import { getInlineEmbedType } from "../../../services/source_embeds";
import utils from "../../../services/utils";
import type { InlineSourceSaves } from "./attachment_saves";
import { watchContentEmbedTools } from "./content_embed_tools";
import ContentEmbed, {
    getNoteActions, MissingContentEmbed, TinyContentEmbed
} from "./ContentEmbed";
import type EmbedHistories from "./embed_history";

interface EmbeddedNoteOptions {
    /** Saves the changes that the content makes to the note, such as a code note. */
    noteEditor?: NoteEditor;
    /** Keeps the undo steps of the content on the undo stack of the text note. */
    histories?: EmbedHistories;
    /** The blocks of the note to show, a `block` link parameter. The whole note when left out. */
    block?: string;
    /** Points the embed at the blocks that its editor holds, once they change. */
    onBlockChange?: (block: string) => void;
}

/**
 * The title and content type that an attachment box was rendered with, by its wrapper. Only boxes
 * whose content reloads itself after each save are kept.
 */
const selfUpdatingBoxes = new WeakMap<HTMLElement, { title: string; type: string }>();

/**
 * Fills an embed box with a note, or with a placeholder once the note no longer exists. Without a
 * box size of its own, the box takes the one of its embed.
 */
export async function loadEmbeddedNote(
    noteId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string,
    { noteEditor, histories, block, onBlockChange }: EmbeddedNoteOptions = {}
) {
    const note = await froca.getNote(noteId, true);
    const el = $el[0];
    const size = boxSize ?? getEmbedBoxSize(el);
    if (!note) {
        const text = t("include_note.missing_note", { noteId });
        await mountEmbedBox(el, h(MissingContentEmbed, { boxSize: size, text }));
        return;
    }

    const viewScope: ViewScope | undefined = block ? { block } : undefined;
    const isExcerpt = !!block;
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
        await mountEmbedBox(el, box, undefined, isExcerpt);
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
        hasDisplayModes: true,
        noteEditor,
        histories,
        block,
        onBlockChange,
        hasCodeLineNumbers: getEmbedCodeView(el.closest(".include-note")).hasCodeLineNumbers
    });

    const box = h(ContentEmbed, {
        boxSize: size,
        title: $link[0],
        content: $renderedContent[0],
        contentType: type,
        notePath: note.noteId,
        viewScope,
        isExcerpt
    });
    await mountEmbedBox(el, box, $renderedContent, isExcerpt);
}

interface EmbeddedAttachmentOptions {
    /** Saves the changes that the content makes to the attachment, such as a canvas drawing. */
    attachmentEditor?: AttachmentEditor;
    /** Keeps the undo steps of the content on the undo stack of the text note. */
    histories?: EmbedHistories;
    /** Whether the content takes the focus once the box is mounted. */
    isFocused?: boolean;
}

/**
 * Fills an embed box with an embedded attachment, under a title linking to it, or with a
 * placeholder once the attachment no longer exists. Without a box size of its own, the box takes
 * the one of its embed.
 */
export async function loadEmbeddedAttachment(
    attachmentId: string,
    $el: JQuery<HTMLElement>,
    boxSize?: string,
    { attachmentEditor, histories, isFocused }: EmbeddedAttachmentOptions = {}
) {
    const attachment = await froca.getAttachment(attachmentId, true);
    const el = $el[0];
    selfUpdatingBoxes.delete(el);
    const size = boxSize ?? getEmbedBoxSize(el);
    if (!attachment) {
        const text = t("include_note.missing_attachment", { attachmentId });
        await mountEmbedBox(el, h(MissingContentEmbed, { boxSize: size, text }));
        return;
    }

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
    const { $renderedContent, type } = await content_renderer.getRenderedContent(attachment, {
        interactive: true,
        mediaEnvironment: "embedded",
        hasDisplayModes: true,
        attachmentEditor,
        histories,
        ...getEmbedCodeView(el.closest(".include-note"))
    });
    if (content_renderer.isSelfUpdatingType(type)) {
        selfUpdatingBoxes.set(el, { title: attachment.title, type });
    }

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
 * Whether every box of `attachment` in `container` shows its latest save without a redraw: the
 * content reloads itself, and the title and content type are unchanged. `false` when `container`
 * has no box of the attachment.
 */
export function showsAttachmentSave(container: HTMLElement, attachment: FAttachment) {
    const boxes = container.querySelectorAll<HTMLElement>(
        `.include-note[data-attachment-id="${attachment.attachmentId}"] > .include-note-wrapper`);
    const type = content_renderer.getRenderingType(attachment);
    return boxes.length > 0 && [ ...boxes ].every((box) => {
        const shown = selfUpdatingBoxes.get(box);
        return shown?.title === attachment.title && shown.type === type;
    });
}

interface InlineEmbedOptions {
    /** Whether the content takes the focus once the box is mounted. */
    isFocused: boolean;
    /** The writes that the text note saves first. */
    saves?: InlineSourceSaves;
    /** Keeps the undo steps of the source on the undo stack of the text note. */
    histories?: EmbedHistories;
}

/**
 * Fills an embed box with what an embed that keeps its source in the note shows, through the
 * component of the `SourceEmbedType` of its language. The box has no title row.
 */
export async function loadInlineEmbed(
    source: InlineEmbedSource,
    $el: JQuery<HTMLElement>,
    boxSize: string | undefined,
    { isFocused, saves, histories }: InlineEmbedOptions
) {
    const type = getInlineEmbedType(source.language);
    const el = $el[0];
    const [ component, { InlineSourceEmbed } ] = await Promise.all([
        type.load(),
        CONTENT_RENDERERS.file.sourceEmbed()
    ]);
    const $renderedContent = $('<div class="rendered-content">');
    const container = $('<div class="source-embed">').appendTo($renderedContent)[0];
    await content_renderer.mountInteractiveWidget(
        h(InlineSourceEmbed, { source, component, saves, histories }), container);

    const box = h(ContentEmbed, {
        boxSize: boxSize ?? getEmbedBoxSize(el),
        content: $renderedContent[0],
        contentType: type.contentType,
        ...(isFocused ? { isFocusedOnMount: true } : {})
    });
    await mountEmbedBox(el, box, $renderedContent);
}

/**
 * Mounts `box` in the embed `el`. An embed that left the page while it loaded gets no box,
 * and `content` rendered for it is disposed: `watchContentEmbeds()` has already passed it.
 */
/**
 * Mounts `box` in the wrapper of the embed `el`, which carries the `excerpt` class while
 * `isExcerpt`. The class is not saved with the note.
 */
async function mountEmbedBox(
    el: HTMLElement,
    box: JSX.Element,
    content?: JQuery<HTMLElement>,
    isExcerpt = false
) {
    if (!el.isConnected) {
        if (content) {
            content_renderer.disposeInteractiveContent(content);
        }
        return;
    }

    const wrapper = getWrapper(el);
    wrapper.classList.toggle("excerpt", isExcerpt);
    await content_renderer.mountInteractiveWidget(box, wrapper);
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
    const { noteId, attachmentId, block, language } = embed.dataset;
    const origin = linkContextMenu.getOriginBelow(anchor, embed);

    if (language) {
        await linkContextMenu.openEmbedContextMenu(origin);
        return;
    }

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

/**
 * Toggles a to-do checkbox on a tap within `TODO_CHECKBOX_HIT_PAD` of it, about a 44px target.
 * The touch is cancelled from `touchstart` on, as the browser focuses the editor before `touchend`
 * and so opens the keyboard. The iOS WebView also dispatches no `change` on a first tap into an
 * unfocused editor. The synthetic `change` reaches CKEditor's `TodoCheckboxChangeObserver`.
 */
export function setupTodoCheckboxTaps(container: HTMLElement) {
    let tapped: HTMLInputElement | null = null;
    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        const target = e.target instanceof Element ? e.target : null;
        // The checkbox sits in the list's gutter, outside its label and item, so the tap is
        // matched by position rather than by its target.
        tapped = touch && e.touches.length === 1 && target?.closest(".todo-list")
            ? findTodoCheckboxAt(container, touch.clientX, touch.clientY)
            : null;
        startX = touch?.clientX ?? 0;
        startY = touch?.clientY ?? 0;
        if (tapped) {
            e.preventDefault();
        }
    };

    const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (touch && Math.hypot(touch.clientX - startX, touch.clientY - startY) > TAP_SLOP) {
            tapped = null;
        }
    };

    // A long press is no tap.
    const onContextMenu = () => {
        tapped = null;
    };

    const onTouchEnd = (e: TouchEvent) => {
        if (!tapped) return;
        const checkbox = tapped;
        tapped = null;
        e.preventDefault();
        // The system back gesture closes the keyboard but leaves the editor focused, and the
        // browser opens the keyboard again as the toggle re-renders the focused editor.
        const active = document.activeElement;
        const isKeyboardOpen = document.getElementById("root-widget")
            ?.classList.contains("virtual-keyboard-opened");
        if (active instanceof HTMLElement && container.contains(active) && !isKeyboardOpen) {
            active.blur();
        }
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    };

    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: false });
    container.addEventListener("contextmenu", onContextMenu);
    return () => {
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
        container.removeEventListener("contextmenu", onContextMenu);
    };
}

const TODO_CHECKBOX_HIT_PAD = 14;
/** How far a touch can move and still count as a tap rather than a scroll. */
const TAP_SLOP = 10;

/** The to-do checkbox nearest to the point, if it lies within `TODO_CHECKBOX_HIT_PAD` of it. */
function findTodoCheckboxAt(container: HTMLElement, x: number, y: number) {
    let nearest: HTMLInputElement | null = null;
    let nearestDistance = Infinity;
    const checkboxes = container.querySelectorAll<HTMLInputElement>(
        '.todo-list__label input[type="checkbox"]');
    for (const checkbox of checkboxes) {
        const rect = checkbox.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (dx <= TODO_CHECKBOX_HIT_PAD && dy <= TODO_CHECKBOX_HIT_PAD && distance < nearestDistance) {
            nearest = checkbox;
            nearestDistance = distance;
        }
    }
    return nearest;
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
