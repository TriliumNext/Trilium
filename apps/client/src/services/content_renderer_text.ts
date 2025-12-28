import FAttachment from "../entities/fattachment.js";
import FNote from "../entities/fnote.js";
import { default as content_renderer, type RenderOptions } from "./content_renderer.js";
import froca from "./froca.js";
import link from "./link.js";
import { renderMathInElement } from "./math.js";
import { getMermaidConfig } from "./mermaid.js";
import { formatCodeBlocks } from "./syntax_highlight.js";
import tree from "./tree.js";
import { isHtmlEmpty } from "./utils.js";

export default async function renderText(note: FNote | FAttachment, $renderedContent: JQuery<HTMLElement>, options: RenderOptions = {}) {
    // entity must be FNote
    const blob = await note.getBlob();

    if (blob && !isHtmlEmpty(blob.content)) {
        $renderedContent.append($('<div class="ck-content">').html(blob.content));
        await renderIncludedNotes($renderedContent[0]);

        if ($renderedContent.find("span.math-tex").length > 0) {
            renderMathInElement($renderedContent[0], { trust: true });
        }

        const getNoteIdFromLink = (el: HTMLElement) => tree.getNoteIdFromUrl($(el).attr("href") || "");
        const referenceLinks = $renderedContent.find<HTMLAnchorElement>("a.reference-link");
        const noteIdsToPrefetch = referenceLinks.map((i, el) => getNoteIdFromLink(el));
        await froca.getNotes(noteIdsToPrefetch);

        for (const el of referenceLinks) {
            const innerSpan = document.createElement("span");
            await link.loadReferenceLinkTitle($(innerSpan), el.href);
            el.replaceChildren(innerSpan);
        }

        await rewriteMermaidDiagramsInContainer($renderedContent[0] as HTMLDivElement);
        await formatCodeBlocks($renderedContent);
    } else if (note instanceof FNote && !options.noChildrenList) {
        await renderChildrenList($renderedContent, note);
    }
}

async function renderIncludedNotes(contentEl: HTMLElement) {
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

        const renderedContent = (await content_renderer.getRenderedContent(note)).$renderedContent;
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
        div.innerHTML = mermaidBlock.querySelector("code")?.innerHTML ?? "";
        mermaidBlock.replaceWith(div);
        nodes.push(div);
    }
}

export async function applyInlineMermaid(container: HTMLDivElement) {
    // Initialize mermaid
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize(getMermaidConfig());
    const nodes = Array.from(container.querySelectorAll<HTMLElement>("div.mermaid-diagram"));
    try {
        await mermaid.run({ nodes });
    } catch (e) {
        console.log(e);
    }
}

async function renderChildrenList($renderedContent: JQuery<HTMLElement>, note: FNote) {
    let childNoteIds = note.getChildNoteIds();

    if (!childNoteIds.length) {
        return;
    }

    $renderedContent.css("padding", "10px");
    $renderedContent.addClass("text-with-ellipsis");

    if (childNoteIds.length > 10) {
        childNoteIds = childNoteIds.slice(0, 10);
    }

    // just load the first 10 child notes
    const childNotes = await froca.getNotes(childNoteIds);

    for (const childNote of childNotes) {
        $renderedContent.append(
            await link.createLink(`${note.noteId}/${childNote.noteId}`, {
                showTooltip: false,
                showNoteIcon: true
            })
        );

        $renderedContent.append("<br>");
    }
}
