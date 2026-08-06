import { TRILIUM_SRC_ATTRIBUTE } from "@triliumnext/commons";

import { embedReferenceImageAsDataUrl, resetImageEmbedBudget } from "./image.js";
import options from "./options.js";

/**
 * Class shared by every surface that renders note content: read-only text notes, revision previews
 * and diffs, doc/help notes, Office file previews, canvas note embeddables, and anything rendered
 * through `content_renderer` (tooltips, included notes, collection previews).
 */
const CONTENT_SELECTOR = ".ck-content";

/**
 * CKEditor's editable carries `.ck-content` too, but its own `ClipboardImageEmbed` plugin has a
 * better hook there: CKEditor's clipboard serializer reconstructs ancestor context and understands
 * widget boundaries, which the range-based serialization below only approximates. So it is skipped.
 */
const EDITOR_SELECTOR = ".ck-editor__editable";

/**
 * Embeds internal images as self-contained `data:` URIs whenever *rendered* note content is copied
 * or dragged out, so it pastes into external applications (email clients, word processors) with the
 * images intact rather than as `api/images/...` references those applications cannot resolve.
 *
 * This is the application-level counterpart to the CKEditor `ClipboardImageEmbed` plugin, which
 * covers the text editor only — leaving every read-only surface (notably long notes, which switch
 * to read-only automatically) still copying bare references. Both halves write
 * {@link TRILIUM_SRC_ATTRIBUTE} next to the embedded URI, so pasting back into a Trilium note
 * restores the original reference instead of uploading a duplicate.
 *
 * When a selection contains nothing embeddable — the common case — the events are left entirely
 * alone and the browser's own (higher-fidelity) serialization is used.
 */
export function setupClipboardImageEmbed() {
    document.addEventListener("copy", onCopy, { capture: true });
    document.addEventListener("dragstart", onDragStart, { capture: true });
    // A cut only ever originates inside the editor, which serializes its own payload — but the
    // embed budget is shared with it, so it still has to start fresh here.
    document.addEventListener("cut", () => resetImageEmbedBudget(), { capture: true });
}

function onCopy(e: ClipboardEvent) {
    // Reset first and unconditionally: this capture listener runs before the editor's own handler,
    // so an editor copy is budgeted by the same allowance even though it is served below.
    resetImageEmbedBudget();

    if (!e.clipboardData || !isEnabled()) {
        return;
    }

    const payload = embedSelection();
    if (!payload) {
        return;
    }

    e.clipboardData.setData("text/html", payload.html);
    e.clipboardData.setData("text/plain", payload.text);
    e.preventDefault();
}

function onDragStart(e: DragEvent) {
    resetImageEmbedBudget();

    if (!e.dataTransfer || !isEnabled()) {
        return;
    }

    // Dragging an image itself carries no selection, so that case is built from the element — and
    // must never fall through to the selection, which at that moment belongs to unrelated content.
    const payload = e.target instanceof HTMLImageElement
        ? (contentRootFor(e.target) ? embedImageElement(e.target) : null)
        : embedSelection();
    if (!payload) {
        return;
    }

    // No `preventDefault()` here — that would cancel the drag. Re-setting the types replaces what
    // the browser put in the drag data store, leaving the other flavors untouched.
    e.dataTransfer.setData("text/html", payload.html);
    e.dataTransfer.setData("text/plain", payload.text);
}

function isEnabled() {
    return options.get("clipboardImageEmbedEnabled") === "true";
}

/** The clipboard payload for the current selection, or `null` when there is nothing to embed. */
function embedSelection() {
    const selection = window.getSelection();
    // Only a single range is serialized below, so a multi-range selection (Firefox allows one to be
    // built with Ctrl+drag) is handed back to the browser rather than silently copying part of it.
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
        return null;
    }

    const range = selection.getRangeAt(0);
    const scope = noteContentScope(range.commonAncestorContainer);
    if (!scope) {
        return null;
    }

    const fragment = range.cloneContents();
    if (!embedImagesIn(fragment)) {
        return null;
    }

    const context = scope.root && { from: range.commonAncestorContainer, root: scope.root };

    return { html: serialize(fragment, context || undefined), text: selection.toString() };
}

/** The clipboard payload for a single dragged image, or `null` when it cannot be embedded. */
function embedImageElement(image: HTMLImageElement) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(image.cloneNode(true));
    if (!embedImagesIn(fragment)) {
        return null;
    }

    return { html: serialize(fragment), text: image.src };
}

/**
 * Rewrite every internal image in the fragment to a `data:` URI, stashing the reference it replaces
 * in {@link TRILIUM_SRC_ATTRIBUTE}. Returns whether anything was embedded, so a selection of plain
 * text (or of images the resolver declined) can be left to the browser untouched.
 */
function embedImagesIn(fragment: DocumentFragment) {
    let embedded = false;

    for (const image of fragment.querySelectorAll("img")) {
        const src = image.getAttribute("src");
        if (!src || image.hasAttribute(TRILIUM_SRC_ATTRIBUTE)) {
            continue;
        }

        const dataUrl = embedReferenceImageAsDataUrl(src);
        if (!dataUrl) {
            continue;
        }

        image.setAttribute("src", dataUrl);
        image.setAttribute(TRILIUM_SRC_ATTRIBUTE, src);
        embedded = true;
    }

    return embedded;
}

/**
 * Serialize a cloned range to clipboard HTML. `cloneContents()` returns only the nodes inside the
 * range — unlike the browser's own serializer it drops the enclosing context, so a selection made
 * inside a list or table would otherwise paste as bare paragraphs. Re-wrapping the fragment in the
 * ancestors between the selection and the note content root puts that structure back.
 */
function serialize(fragment: DocumentFragment, context?: { from: Node; root: HTMLElement }) {
    let container = document.createElement("div");
    container.appendChild(fragment);

    if (context) {
        for (const ancestor of ancestorsBetween(context.from, context.root)) {
            const wrapper = ancestor.cloneNode(false) as HTMLElement;
            wrapper.append(...container.childNodes);
            container = document.createElement("div");
            container.appendChild(wrapper);
        }
    }

    return container.innerHTML;
}

/** The elements from `node` up to (but excluding) `root`, innermost first. */
function ancestorsBetween(node: Node, root: HTMLElement) {
    const ancestors: Element[] = [];

    let current = node instanceof Element ? node : node.parentElement;
    while (current && current !== root) {
        ancestors.push(current);
        current = current.parentElement;
    }

    return ancestors;
}

/**
 * Whether a selection anchored at `node` covers note content this handler should serve, and if so
 * the single container to re-wrap the cloned range against.
 *
 * A selection usually sits inside one rendered container, which becomes `root`. But it often spans
 * several: an LLM chat answer renders each markdown block as its own container, so selecting a whole
 * reply anchors above all of them. Those are still worth embedding — there is simply no single
 * ancestor chain to restore, so `root` is left undefined and the clone is serialized as-is.
 *
 * Returns `undefined` (leave the event alone) when no note content is involved at all, or when the
 * text editor is, since its own plugin serializes that far better than this can.
 */
function noteContentScope(node: Node | null) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!element || element.closest(EDITOR_SELECTOR)) {
        return undefined;
    }

    const enclosing = element.closest<HTMLElement>(CONTENT_SELECTOR);
    if (enclosing) {
        return { root: enclosing };
    }

    // Spanning several containers. Bail if an editor is anywhere in the span rather than trying to
    // out-serialize it.
    if (element.querySelector(CONTENT_SELECTOR) && !element.querySelector(EDITOR_SELECTOR)) {
        return { root: undefined };
    }

    return undefined;
}

/** The note-content container holding `node`, used to decide whether a dragged image qualifies. */
function contentRootFor(node: Node | null) {
    const element = node instanceof Element ? node : node?.parentElement;
    const root = element?.closest<HTMLElement>(CONTENT_SELECTOR);

    return root && !root.closest(EDITOR_SELECTOR) ? root : null;
}
