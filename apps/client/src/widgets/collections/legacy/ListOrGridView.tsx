import "./ListOrGridView.css";
import { Card, CardFrame, CardSection } from "../../react/Card";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import attribute_renderer from "../../../services/attribute_renderer";
import content_renderer from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import CollectionProperties from "../../note_bars/CollectionProperties";
import { useImperativeSearchHighlighlighting, useNoteLabel, useNoteLabelBoolean, useNoteProperty } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoteLink from "../../react/NoteLink";
import { ViewModeProps } from "../interface";
import { Pager, usePagination } from "../Pagination";
import { filterChildNotes, useFilteredNoteIds } from "./utils";
import { JSX } from "preact/jsx-runtime";
import { clsx } from "clsx";
import ActionButton from "../../react/ActionButton";
import linkContextMenuService from "../../../menus/link_context_menu";
import { TargetedMouseEvent } from "preact";

export function ListView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps<{}>) {
    const expandDepth = useExpansionDepth(note);
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const noteType = useNoteProperty(note, "type");
    const hasCollectionProperties = [ "book", "search" ].includes(noteType ?? "");

    return (
        <div className="note-list list-view">
            <CollectionProperties
                note={note}
                centerChildren={<Pager {...pagination} />}
            />

            { noteIds.length > 0 && <div className="note-list-wrapper">
                {!hasCollectionProperties && <Pager {...pagination} />}

                <Card className={clsx("nested-note-list", {"search-results": (noteType === "search")})}>
                    {pageNotes?.map(childNote => (
                        <ListNoteCard
                            key={childNote.noteId}
                            note={childNote} parentNote={note}
                            expandDepth={expandDepth} highlightedTokens={highlightedTokens}
                            currentLevel={1} includeArchived={includeArchived} />
                    ))}
                </Card>

                <Pager {...pagination} />
            </div>}
        </div>
    );
}

export function GridView({ note, noteIds: unfilteredNoteIds, highlightedTokens }: ViewModeProps<{}>) {
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const noteType = useNoteProperty(note, "type");
    const hasCollectionProperties = [ "book", "search" ].includes(noteType ?? "");

    return (
        <div className="note-list grid-view">
            <CollectionProperties
                note={note}
                centerChildren={<Pager {...pagination} />}
            />

            <div className="note-list-wrapper">
                {!hasCollectionProperties && <Pager {...pagination} />}

                <div className={clsx("note-list-container use-tn-links", {"search-results": (noteType === "search")})}>
                    {pageNotes?.map(childNote => (
                        <GridNoteCard key={note.noteId}
                                      note={childNote}
                                      parentNote={note}
                                      highlightedTokens={highlightedTokens}
                                      includeArchived={includeArchived} />
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

    let subSections: JSX.Element | undefined = undefined;
    if (isExpanded) {
        subSections = <>
            <CardSection className="note-content-preview">
                <NoteContent note={note}
                             highlightedTokens={highlightedTokens}
                             noChildrenList
                             includeArchivedNotes={includeArchived} />
            </CardSection>

            <NoteChildren note={note}
                          parentNote={parentNote}
                          highlightedTokens={highlightedTokens}
                          currentLevel={currentLevel}
                          expandDepth={expandDepth}
                          includeArchived={includeArchived} />
        </>
    }
    
    return (
        <CardSection
            className={clsx("nested-note-list-item", "no-tooltip-preview", note.getColorClass(), {
                "expanded": isExpanded,
                "archived": note.isArchived
            })}
            subSections={subSections}
            subSectionsVisible={isExpanded}
            highlightOnHover
            data-note-id={note.noteId}
        >
            <h5>
                <span className={`note-expander ${isExpanded ? "bx bx-chevron-down" : "bx bx-chevron-right"}`} 
                      onClick={() => setExpanded(!isExpanded)}/>
                <Icon className="note-icon" icon={note.getIcon()} />
                <NoteLink className="note-book-title"
                          notePath={notePath}
                          noPreview
                          showNotePath={parentNote.type === "search"}
                          highlightedTokens={highlightedTokens} />
                <NoteAttributes note={note} />
                <NoteMenuButton notePath={notePath} />
            </h5>
        </CardSection>
    );
}

interface GridNoteCardProps {
    note: FNote;
    parentNote: FNote;
    highlightedTokens: string[] | null | undefined;
    includeArchived: boolean
}

function GridNoteCard(props: GridNoteCardProps) {
    const notePath = getNotePath(props.parentNote, props.note);

    return (
        <CardFrame className={clsx("note-book-card", "no-tooltip-preview", "block-link", {
                "archived": props.note.isArchived
             })}
             data-href={`#${notePath}`}
             data-note-id={props.note.noteId}
             onClick={(e) => link.goToLink(e)}
        >
            <h5 className={clsx("note-book-header", props.note.getColorClass())}>
                <Icon className="note-icon" icon={props.note.getIcon()} />
                <NoteLink className="note-book-title"
                          notePath={notePath}
                          noPreview
                          showNotePath={props.parentNote.type === "search"}
                          highlightedTokens={props.highlightedTokens}
                />
                <NoteMenuButton notePath={notePath} />
            </h5>
            <NoteContent note={props.note}
                         trim
                         highlightedTokens={props.highlightedTokens}
                         includeArchivedNotes={props.includeArchived}
            />
        </CardFrame>
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

export function NoteContent({ note, trim, noChildrenList, highlightedTokens, includeArchivedNotes }: {
    note: FNote;
    trim?: boolean;
    noChildrenList?: boolean;
    highlightedTokens: string[] | null | undefined;
    includeArchivedNotes: boolean;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    const [ready, setReady] = useState(false);
    const [noteType, setNoteType] = useState<string>("none");

    useEffect(() => {
        content_renderer.getRenderedContent(note, {
            trim,
            noChildrenList,
            noIncludedNotes: true,
            includeArchivedNotes
        })
            .then(({ $renderedContent, type }) => {
                if (!contentRef.current) return;
                if ($renderedContent[0].innerHTML) {
                    contentRef.current.replaceChildren(...$renderedContent);
                } else {
                    contentRef.current.replaceChildren();
                }
                highlightSearch(contentRef.current);
                setNoteType(type);
                setReady(true);
            })
            .catch(e => {
                console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
                console.error(e);
                contentRef.current?.replaceChildren(t("collections.rendering_error"));
                setReady(true);
            });
    }, [ note, highlightedTokens ]);

    return <div ref={contentRef} className={clsx("note-book-content", `type-${noteType}`, {"note-book-content-ready": ready})} />;
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

function NoteMenuButton(props: {notePath: string}) {
    const openMenu = useCallback((e: TargetedMouseEvent<HTMLElement>) => {
            linkContextMenuService.openContextMenu(props.notePath, e);
            e.stopPropagation()
    }, [props.notePath]);

    return  <ActionButton className="note-book-item-menu"
                          icon="bx bx-dots-vertical-rounded" text=""
                          onClick={openMenu} 
            />
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