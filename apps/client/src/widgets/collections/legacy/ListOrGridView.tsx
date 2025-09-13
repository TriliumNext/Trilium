import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import FNote from "../../../entities/fnote";
import Icon from "../../react/Icon";
import { ViewModeProps } from "../interface";
import {  useNoteLabelBoolean, useImperativeSearchHighlighlighting } from "../../react/hooks";
import NoteLink from "../../react/NoteLink";
import "./ListOrGridView.css";
import content_renderer from "../../../services/content_renderer";
import { Pager, usePagination } from "../Pagination";
import tree from "../../../services/tree";
import link from "../../../services/link";
import { t } from "../../../services/i18n";
import attribute_renderer from "../../../services/attribute_renderer";

export function ListView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps) {
    const [ isExpanded ] = useNoteLabelBoolean(note, "expanded");
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);

    return (
        <div class="note-list list-view">
            { noteIds.length > 0 && <div class="note-list-wrapper">
                <Pager {...pagination} />

                <div class="note-list-container use-tn-links">
                    {pageNotes?.map(childNote => (
                        <ListNoteCard note={childNote} parentNote={note} expand={isExpanded} highlightedTokens={highlightedTokens} />
                    ))}
                </div>

                <Pager {...pagination} />
            </div>}
        </div>
    );
}

export function GridView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps) {
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);

    return (
        <div class="note-list grid-view">
            <div class="note-list-wrapper">
                <Pager {...pagination} />

                <div class="note-list-container use-tn-links">
                    {pageNotes?.map(childNote => (
                        <GridNoteCard note={childNote} parentNote={note} highlightedTokens={highlightedTokens} />
                    ))}
                </div>

                <Pager {...pagination} />
            </div>
        </div>
    );
}

function ListNoteCard({ note, parentNote, expand, highlightedTokens }: { note: FNote, parentNote: FNote, expand?: boolean, highlightedTokens: string[] | null | undefined }) {
    const [ isExpanded, setExpanded ] = useState(expand);
    const notePath = getNotePath(parentNote, note);

    // Reset expand state if switching to another note.
    useEffect(() => setExpanded(expand), [ note ]);

    return (
        <div
            className={`note-book-card no-tooltip-preview ${isExpanded ? "expanded" : ""}`}
            data-note-id={note.noteId}
        >
            <h5 className="note-book-header">
                <span
                    className={`note-expander ${isExpanded ? "bx bx-chevron-down" : "bx bx-chevron-right"}`}
                    onClick={() => setExpanded(!isExpanded)}
                />

                <Icon className="note-icon" icon={note.getIcon()} />
                <NoteLink className="note-book-title" notePath={notePath} noPreview showNotePath={note.type === "search"} highlightedTokens={highlightedTokens} />
                <NoteAttributes note={note} />
            </h5>

            {isExpanded && <>
                <NoteContent note={note} highlightedTokens={highlightedTokens} />
                <NoteChildren note={note} parentNote={parentNote} highlightedTokens={highlightedTokens} />
            </>}
        </div>
    )
}

function GridNoteCard({ note, parentNote, highlightedTokens }: { note: FNote, parentNote: FNote, highlightedTokens: string[] | null | undefined }) {
    const titleRef = useRef<HTMLSpanElement>(null);
    const [ noteTitle, setNoteTitle ] = useState<string>();
    const notePath = getNotePath(parentNote, note);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    useEffect(() => {
        tree.getNoteTitle(note.noteId, parentNote.noteId).then(setNoteTitle);
    }, [ note ]);

    useEffect(() => highlightSearch(titleRef.current), [ noteTitle, highlightedTokens ]);

    return (
        <div
            className={`note-book-card no-tooltip-preview block-link`}
            data-href={`#${notePath}`}
            data-note-id={note.noteId}
            onClick={(e) => link.goToLink(e)}
        >
            <h5 className="note-book-header">
                <Icon className="note-icon" icon={note.getIcon()} />
                <span ref={titleRef} className="note-book-title">{noteTitle}</span>
                <NoteAttributes note={note} />
            </h5>
            <NoteContent note={note} trim highlightedTokens={highlightedTokens} />
        </div>
    )
}

function NoteAttributes({ note }: { note: FNote }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        attribute_renderer.renderNormalAttributes(note).then(({$renderedAttributes}) => {
            ref.current?.replaceChildren(...$renderedAttributes);
        });
    }, [ note ]);

    return <span className="note-list-attributes" ref={ref} />
}

function NoteContent({ note, trim, highlightedTokens }: { note: FNote, trim?: boolean, highlightedTokens }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    useEffect(() => {
        content_renderer.getRenderedContent(note, { trim })
            .then(({ $renderedContent, type }) => {
                if (!contentRef.current) return;
                contentRef.current.replaceChildren(...$renderedContent);
                contentRef.current.classList.add(`type-${type}`);
                highlightSearch(contentRef.current);
            })
            .catch(e => {
                console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
                console.error(e);
                contentRef.current?.replaceChildren(t("collections.rendering_error"));
            })
    }, [ note, highlightedTokens ]);

    return <div ref={contentRef} className="note-book-content" />;
}

function NoteChildren({ note, parentNote, highlightedTokens }: { note: FNote, parentNote: FNote, highlightedTokens: string[] | null | undefined }) {
    const imageLinks = note.getRelations("imageLink");
    const [ childNotes, setChildNotes ] = useState<FNote[]>();

    useEffect(() => {
        note.getChildNotes().then(childNotes => {
            const filteredChildNotes = childNotes.filter((childNote) => !imageLinks.find((rel) => rel.value === childNote.noteId));
            setChildNotes(filteredChildNotes);
        });
    }, [ note ]);

    return childNotes?.map(childNote => <ListNoteCard note={childNote} parentNote={parentNote} highlightedTokens={highlightedTokens} />)
}

/**
 * Filters the note IDs for the legacy view to filter out subnotes that are already included in the note content such as images, included notes.
 */
function useFilteredNoteIds(note: FNote, noteIds: string[]) {
    return useMemo(() => {
        const includedLinks = note ? note.getRelations().filter((rel) => rel.name === "imageLink" || rel.name === "includeNoteLink") : [];
        const includedNoteIds = new Set(includedLinks.map((rel) => rel.value));
        return noteIds.filter((noteId) => !includedNoteIds.has(noteId) && noteId !== "_hidden");
    }, noteIds);
}

function getNotePath(parentNote: FNote, childNote: FNote) {
    if (parentNote.type === "search") {
        // for search note parent, we want to display a non-search path
        return childNote.noteId;
    } else {
        return `${parentNote.noteId}/${childNote.noteId}`
    }
}
