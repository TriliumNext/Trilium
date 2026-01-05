import "./ListOrGridView.css";

import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import attribute_renderer from "../../../services/attribute_renderer";
import content_renderer from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import { useImperativeSearchHighlighlighting, useNoteLabel, useNoteLabelBoolean } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteLink from "../../react/NoteLink";
import { ViewModeProps } from "../interface";
import { Pager, usePagination } from "../Pagination";
import { filterChildNotes, useFilteredNoteIds } from "./utils";

export function ListView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps<{}>) {
    const expandDepth = useExpansionDepth(note);
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");

    return (
        <div class="note-list list-view">
            { noteIds.length > 0 && <div class="note-list-wrapper">
                <Pager {...pagination} />

                <div class="note-list-container use-tn-links">
                    {pageNotes?.map(childNote => (
                        <ListNoteCard
                            key={childNote.noteId}
                            note={childNote} parentNote={note}
                            expandDepth={expandDepth} highlightedTokens={highlightedTokens}
                            currentLevel={1} includeArchived={includeArchived} />
                    ))}
                </div>

                <Pager {...pagination} />
            </div>}
        </div>
    );
}

export function GridView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps<{}>) {
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

function ListNoteCard({ note, parentNote, highlightedTokens, currentLevel, expandDepth, includeArchived }: {
    note: FNote,
    parentNote: FNote,
    currentLevel: number,
    expandDepth: number,
    highlightedTokens: string[] | null | undefined;
    includeArchived: boolean;
}) {

    const [ isExpanded, setExpanded ] = useState(currentLevel <= expandDepth);
    const notePath = getNotePath(parentNote, note);

    // Reset expand state if switching to another note, or if user manually toggled expansion state.
    useEffect(() => setExpanded(currentLevel <= expandDepth), [ note, currentLevel, expandDepth ]);

    return (
        <div
            className={`note-book-card no-tooltip-preview ${isExpanded ? "expanded" : ""} ${note.isArchived ? "archived" : ""}`}
            data-note-id={note.noteId}
        >
            <h5 className="note-book-header">
                <span
                    className={`note-expander ${isExpanded ? "bx bx-chevron-down" : "bx bx-chevron-right"}`}
                    onClick={() => setExpanded(!isExpanded)}
                />

                <Icon className="note-icon" icon={note.getIcon()} />
                <NoteLink className="note-book-title" notePath={notePath} noPreview showNotePath={parentNote.type === "search"} highlightedTokens={highlightedTokens} />
                <NoteAttributes note={note} />
            </h5>

            {isExpanded && <>
                <NoteContent note={note} highlightedTokens={highlightedTokens} noChildrenList />
                <NoteChildren note={note} parentNote={parentNote} highlightedTokens={highlightedTokens} currentLevel={currentLevel} expandDepth={expandDepth} includeArchived={includeArchived} />
            </>}
        </div>
    );
}

function GridNoteCard({ note, parentNote, highlightedTokens }: { note: FNote, parentNote: FNote, highlightedTokens: string[] | null | undefined }) {
    const notePath = getNotePath(parentNote, note);

    return (
        <div
            className={`note-book-card no-tooltip-preview block-link ${note.isArchived ? "archived" : ""}`}
            data-href={`#${notePath}`}
            data-note-id={note.noteId}
            onClick={(e) => link.goToLink(e)}
        >
            <h5 className="note-book-header">
                <Icon className="note-icon" icon={note.getIcon()} />
                <NoteLink className="note-book-title" notePath={notePath} noPreview showNotePath={parentNote.type === "search"} highlightedTokens={highlightedTokens} />
                <NoteAttributes note={note} />
            </h5>
            <NoteContent
                note={note}
                trim
                highlightedTokens={highlightedTokens}
            />
        </div>
    );
}

function NoteAttributes({ note }: { note: FNote }) {
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        attribute_renderer.renderNormalAttributes(note).then(({$renderedAttributes}) => {
            ref.current?.replaceChildren(...$renderedAttributes);
        });
    }, [ note ]);

    return <span className="note-list-attributes" ref={ref} />;
}

function NoteContent({ note, trim, noChildrenList, highlightedTokens }: { note: FNote, trim?: boolean, noChildrenList?: boolean, highlightedTokens: string[] | null | undefined }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    useEffect(() => {
        content_renderer.getRenderedContent(note, {
            trim,
            noChildrenList
        })
            .then(({ $renderedContent, type }) => {
                if (!contentRef.current) return;
                if ($renderedContent[0].innerHTML) {
                    contentRef.current.replaceChildren(...$renderedContent);
                } else {
                    contentRef.current.replaceChildren();
                }
                contentRef.current.classList.add(`type-${type}`);
                highlightSearch(contentRef.current);
            })
            .catch(e => {
                console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
                console.error(e);
                contentRef.current?.replaceChildren(t("collections.rendering_error"));
            });
    }, [ note, highlightedTokens ]);

    return <div ref={contentRef} className="note-book-content" />;
}

function NoteChildren({ note, parentNote, highlightedTokens, currentLevel, expandDepth, includeArchived }: {
    note: FNote,
    parentNote: FNote,
    currentLevel: number,
    expandDepth: number,
    highlightedTokens: string[] | null | undefined
    includeArchived: boolean;
}) {
    const [ childNotes, setChildNotes ] = useState<FNote[]>();

    useEffect(() => {
        filterChildNotes(note, includeArchived).then(setChildNotes);
    }, [ note, includeArchived ]);

    return childNotes?.map(childNote => <ListNoteCard
        key={childNote.noteId}
        note={childNote}
        parentNote={parentNote}
        highlightedTokens={highlightedTokens}
        currentLevel={currentLevel + 1} expandDepth={expandDepth}
        includeArchived={includeArchived}
    />);
}

function getNotePath(parentNote: FNote, childNote: FNote) {
    if (parentNote.type === "search") {
        // for search note parent, we want to display a non-search path
        return childNote.noteId;
    }
    return `${parentNote.noteId}/${childNote.noteId}`;

}

function useExpansionDepth(note: FNote) {
    const [ expandDepth ] = useNoteLabel(note, "expanded");

    if (expandDepth === null || expandDepth === undefined) { // not defined
        return 0;
    } else if (expandDepth === "") { // defined without value
        return 1;
    } else if (expandDepth === "all") {
        return Number.MAX_SAFE_INTEGER;
    }
    return parseInt(expandDepth, 10);

}
