import FAttachment from "../entities/fattachment.js";
import FNote from "../entities/fnote.js";
import { default as content_renderer, type RenderOptions } from "./content_renderer.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import link from "./link.js";
import { applyLinkEmbeds } from "./link_embed.js";
import { renderMathInElement } from "./math.js";
import { getMermaidConfig, loadElkIfNeeded, postprocessMermaidSvg } from "./mermaid.js";
import { sanitizeNoteContentHtml } from "./sanitize_content.js";
import { formatCodeBlocks } from "./syntax_highlight.js";
import tree from "./tree.js";
import { isHtmlEmpty } from "./utils.js";

export default async function renderText(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
    // entity must be FNote
    const blob = await note.getBlob();

    if (blob && !isHtmlEmpty(blob.content)) {
        $renderedContent.append($('<div class="ck-content">').html(sanitizeNoteContentHtml(blob.content)));
        await postProcessRichContent(note, $renderedContent, options);
    } else if (note instanceof FNote && !options.noChildrenList) {
        await renderChildrenList($renderedContent, note, options.includeArchivedNotes ?? false);
    }
}

/**
 * Apply the post-render passes that make CKEditor-compatible HTML fully
 * interactive: expand `<section class="include-note">`, render inline math and
 * Mermaid diagrams, rewrite reference-link titles, and highlight code blocks.
 * Assumes the caller has already appended the HTML inside a `.ck-content` child
 * of `$renderedContent`.
 */
export async function postProcessRichContent(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
    const seenNoteIds = options.seenNoteIds ?? new Set<string>();
    seenNoteIds.add("noteId" in note ? note.noteId : note.attachmentId);
    if (!options.noIncludedNotes) {
        await renderIncludedNotes($renderedContent[0], seenNoteIds);
    } else {
        $renderedContent.find("section.include-note").remove();
    }

    if ($renderedContent.find("span.math-tex").length > 0) {
        renderMathInElement($renderedContent[0], { trust: true });
    }

    const getNoteIdFromLink = (el: HTMLElement) => tree.getNoteIdFromUrl($(el).attr("href") || "");
    const referenceLinks = $renderedContent.find<HTMLAnchorElement>("a.reference-link");
    const noteIdsToPrefetch = referenceLinks.map((i, el) => getNoteIdFromLink(el));
    await froca.getNotes(noteIdsToPrefetch);

    await Promise.all(referenceLinks.toArray().map(async (el) => {
        const innerSpan = document.createElement("span");
        await link.loadReferenceLinkTitle($(innerSpan), el.getAttribute("href"));
        el.replaceChildren(innerSpan);
    }));

    applyLinkEmbeds($renderedContent[0]);
    await rewriteMermaidDiagramsInContainer($renderedContent[0] as HTMLDivElement);
    await formatCodeBlocks($renderedContent);
}

async function renderIncludedNotes(contentEl: HTMLElement, seenNoteIds: Set<string>) {
    // TODO: Consider duplicating with server's share/content_renderer.ts.
    const includeNoteEls = contentEl.querySelectorAll("section.include-note");

    // Gather the list of items to load.
    const noteIds: string[] = [];
    for (const includeNoteEl of includeNoteEls) {
        const noteId = includeNoteEl.getAttribute("data-note-id");
        if (noteId) {
            noteIds.push(noteId);
        }
    }

    // Load the required notes.
    await froca.getNotes(noteIds);

    // Render and integrate the notes.
    for (const includeNoteEl of includeNoteEls) {
        const noteId = includeNoteEl.getAttribute("data-note-id");
        if (!noteId) continue;

        const note = froca.getNoteFromCache(noteId);
        if (!note) {
            console.warn(`Unable to include ${noteId} because it could not be found.`);
            continue;
        }

        if (seenNoteIds.has(noteId)) {
            console.warn(`Skipping inclusion of ${noteId} to avoid circular reference.`);
            includeNoteEl.remove();
            continue;
        }

        const renderedContent = (await content_renderer.getRenderedContent(note, {
            seenNoteIds
        })).$renderedContent;
        includeNoteEl.replaceChildren(...renderedContent);
    }
}

/** Rewrite the code block from <pre><code> to <div> in order not to apply a codeblock style to it. */
export async function rewriteMermaidDiagramsInContainer(container: HTMLDivElement) {
    const mermaidBlocks = container.querySelectorAll('pre:has(code[class="language-mermaid"])');
    if (!mermaidBlocks.length) return;
    const nodes: HTMLElement[] = [];

    for (const mermaidBlock of mermaidBlocks) {
        const div = document.createElement("div");
        div.classList.add("mermaid-diagram");
        /* v8 ignore next -- defensive fallback: the `:has(code[...])` selector guarantees a `<code>` child whose innerHTML is always a string */
        div.innerHTML = mermaidBlock.querySelector("code")?.innerHTML ?? "";
        mermaidBlock.replaceWith(div);
        nodes.push(div);
    }
}

/**
 * Per-container cache of rendered mermaid SVG keyed by diagram source text.
 * Populated after each successful render; reused on subsequent renders to
 * avoid flicker when the preview HTML is regenerated (e.g. live markdown
 * editing). Entries for diagrams no longer present in the container are
 * evicted on each run so the cache can't grow unbounded.
 */
const mermaidSvgCache = new WeakMap<HTMLElement, Map<string, string>>();

/**
 * Per-container, ordered snapshot of the most recently rendered SVGs. Used as
 * a positional placeholder so edits to a diagram's source keep the previous
 * SVG visible while the new one renders offscreen.
 */
const mermaidLastRenderedByPosition = new WeakMap<HTMLElement, string[]>();

/** Monotonic id for mermaid.render(), which requires a unique element id per call. */
let mermaidRenderId = 0;

export async function applyInlineMermaid(container: HTMLDivElement) {
    const nodes = Array.from(container.querySelectorAll<HTMLElement>("div.mermaid-diagram"));
    if (!nodes.length) {
        mermaidLastRenderedByPosition.delete(container);
        return;
    }

    let cache = mermaidSvgCache.get(container);
    if (!cache) {
        cache = new Map();
        mermaidSvgCache.set(container, cache);
    }
    const lastRendered = mermaidLastRenderedByPosition.get(container) ?? [];

    // Decide per node: exact cache hit → paint final SVG; source changed →
    // paint the previous SVG (by position) as a placeholder and queue a
    // re-render. This way the user keeps seeing the old diagram until mermaid
    // has finished producing the new one.
    const pending: Array<{ visible: HTMLElement; source: string }> = [];
    const seenSources = new Set<string>();
    for (const [ index, node ] of nodes.entries()) {
        /* v8 ignore next -- defensive fallback: textContent on an HTMLElement is always a string */
        const source = (node.textContent ?? "").trim();
        seenSources.add(source);

        const cached = cache.get(source);
        if (cached) {
            node.innerHTML = cached;
            node.setAttribute("data-processed", "true");
            node.classList.remove("mermaid-error");
            continue;
        }

        pending.push({ visible: node, source });
        const placeholder = lastRendered[index];
        if (placeholder) {
            node.innerHTML = placeholder;
        }
    }

    // Evict cache entries whose source is no longer present.
    for (const key of [ ...cache.keys() ]) {
        if (!seenSources.has(key)) cache.delete(key);
    }

    if (!pending.length) {
        mermaidLastRenderedByPosition.set(container, nodes.map((n) => n.innerHTML));
        return;
    }

    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ ...getMermaidConfig(), startOnLoad: false });

    // Render each diagram to an SVG string via mermaid.render() — the same API the
    // editable note and standalone Mermaid widget use. mermaid.render() builds its
    // own correctly-sized measurement element; rendering in place via mermaid.run()
    // inside a collapsed offscreen container silently broke measurement-sensitive
    // diagrams (e.g. gantt). Each diagram renders independently so one failure
    // surfaces its own error instead of blanking the diagrams beside it.
    for (const { visible, source } of pending) {
        try {
            await loadElkIfNeeded(mermaid, source);
            const { svg } = await mermaid.render(`mermaid-inline-${mermaidRenderId++}`, source);
            const processed = postprocessMermaidSvg(svg);
            visible.innerHTML = processed;
            visible.setAttribute("data-processed", "true");
            visible.classList.remove("mermaid-error");
            cache.set(source, processed);
        } catch (e) {
            console.error(e);
            // Surface the failure in place, replacing any placeholder from a prior
            // good render. A broken diagram must look broken — keeping the stale
            // render would hide the error until a full refresh.
            showMermaidError(visible, e);
        }
    }

    mermaidLastRenderedByPosition.set(container, nodes.map((n) => n.innerHTML));
}

/** Render a mermaid failure in place so it's visible instead of console-only. */
function showMermaidError(node: HTMLElement, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    node.removeAttribute("data-processed");
    node.classList.add("mermaid-error");
    node.textContent = t("content_renderer.mermaid_diagram_error", { error: message });
}

export async function renderChildrenList($renderedContent: JQuery<HTMLElement>, note: FNote, includeArchivedNotes: boolean) {
    let childNoteIds = note.getChildNoteIds();

    if (!childNoteIds.length) {
        return;
    }

    $renderedContent.addClass("text-with-ellipsis");

    // just load the first 10 child notes
    if (childNoteIds.length > 10) {
        childNoteIds = childNoteIds.slice(0, 10);
    }

    const childNotes = await froca.getNotes(childNoteIds);

    for (const childNote of childNotes) {
        if (childNote.isArchived && !includeArchivedNotes) continue;

        $renderedContent.append(
            await link.createLink(`${note.noteId}/${childNote.noteId}`, {
                showTooltip: false,
                showNoteIcon: true
            })
        );

        $renderedContent.append("<br>");
    }
}
