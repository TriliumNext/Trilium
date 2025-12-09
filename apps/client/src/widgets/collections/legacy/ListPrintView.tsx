import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import froca from "../../../services/froca";
import type FNote from "../../../entities/fnote";
import content_renderer from "../../../services/content_renderer";
import type { ViewModeProps } from "../interface";
import { filterChildNotes, useFilteredNoteIds } from "./utils";

interface NotesWithContent {
    note: FNote;
    contentEl: HTMLElement;
}

export function ListPrintView({ note, noteIds: unfilteredNoteIds, onReady, onProgressChanged }: ViewModeProps<{}>) {
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const [ notesWithContent, setNotesWithContent ] = useState<NotesWithContent[]>();

    useLayoutEffect(() => {
        const noteIdsSet = new Set<string>();

        froca.getNotes(noteIds).then(async (notes) => {
            const noteIdsWithChildren = await note.getSubtreeNoteIds(true);
            const notesWithContent: NotesWithContent[] = [];

            async function processNote(note: FNote, depth: number) {
                const content = await content_renderer.getRenderedContent(note, {
                    trim: false,
                    noChildrenList: true
                });

                const contentEl = content.$renderedContent[0];

                insertPageTitle(contentEl, note.title);
                rewriteHeadings(contentEl, depth);
                noteIdsSet.add(note.noteId);
                notesWithContent.push({ note, contentEl });

                if (onProgressChanged) {
                    onProgressChanged(notesWithContent.length / noteIdsWithChildren.length);
                }

                if (note.hasChildren()) {
                    const filteredChildNotes = await filterChildNotes(note);
                    for (const childNote of filteredChildNotes) {
                        await processNote(childNote, depth + 1);
                    }
                }
            }

            for (const note of notes) {
                await processNote(note, 1);
            }

            // After all notes are processed, rewrite links
            for (const { contentEl } of notesWithContent) {
                rewriteLinks(contentEl, noteIdsSet);
            }

            setNotesWithContent(notesWithContent);
        });
    }, [noteIds]);

    useEffect(() => {
        if (notesWithContent && onReady) {
            onReady();
        }
    }, [ notesWithContent, onReady ]);

    return (
        <div class="note-list list-print-view">
            <div class="note-list-container use-tn-links">
                <h1>{note.title}</h1>

                {notesWithContent?.map(({ note: childNote, contentEl }) => (
                    <section id={`note-${childNote.noteId}`} class="note" dangerouslySetInnerHTML={{ __html: contentEl.innerHTML }} />
                ))}
            </div>
        </div>
    );
}

function insertPageTitle(contentEl: HTMLElement, title: string) {
    const pageTitleEl = document.createElement("h1");
    pageTitleEl.textContent = title;
    contentEl.prepend(pageTitleEl);
}

function rewriteHeadings(contentEl: HTMLElement, depth: number) {
    const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
    for (const headingEl of headings) {
        const currentLevel = parseInt(headingEl.tagName.substring(1), 10);
        const newLevel = Math.min(currentLevel + depth, 6);
        const newHeadingEl = document.createElement(`h${newLevel}`);
        newHeadingEl.innerHTML = headingEl.innerHTML;
        headingEl.replaceWith(newHeadingEl);
    }
}

function rewriteLinks(contentEl: HTMLElement, noteIdsSet: Set<string>) {
    const linkEls = contentEl.querySelectorAll("a");
    for (const linkEl of linkEls) {
        const href = linkEl.getAttribute("href");
        if (href && href.startsWith("#root/")) {
            const noteId = href.split("/").at(-1);

            if (noteId && noteIdsSet.has(noteId)) {
                linkEl.setAttribute("href", `#note-${noteId}`);
            } else {
                // Link to note not in the print view, remove link but keep text
                const spanEl = document.createElement("span");
                spanEl.innerHTML = linkEl.innerHTML;
                linkEl.replaceWith(spanEl);
            }
        }
    }
}
