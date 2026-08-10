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
import { Pager, usePagination, PaginationContext } from "../Pagination";
import { filterChildNotes, useFilteredNoteIds } from "./utils";
import { JSX } from "preact/jsx-runtime";
import { clsx } from "clsx";
import ActionButton from "../../react/ActionButton";
import linkContextMenuService from "../../../menus/link_context_menu";
import { ComponentChildren, TargetedMouseEvent } from "preact";

const contentSizeObserver = new ResizeObserver(onContentResized);

/**
 * Opt-in adjustments for callers that reuse the list outside a collection note. Every field is
 * optional and defaults to the collection behaviour, so existing views are unaffected.
 */
export interface ListViewOptions {
    /** Heading shown at the top of the list's card. */
    title?: string;
    /**
     * Lays the items out the way search results are shown — the note's path under its title, and a
     * path that addresses the note directly rather than through the parent. Search notes always use
     * this layout; set it when the parent isn't the notes' real parent.
     */
    searchResultsLayout?: boolean;
    /** Omits the nested subnote tree, leaving only each note's own content preview. */
    hideSubNotes?: boolean;
    /**
     * Supplies a row's nested notes, replacing its real child notes. Lets a caller present its own
     * hierarchy — grouping scattered notes by where they live — through the same nesting UI.
     */
    resolveChildren?: (note: FNote) => FNote[];
    /**
     * Decides per row whether its content preview is rendered inline; previews show for every row by
     * default. Useful when a caller inserts rows of its own, whose content is not the point.
     *
     * A row without an inline preview gets the hover preview tooltip on its link instead, so the
     * content stays reachable — the two are alternatives, never both at once.
     */
    showPreview?: (note: FNote) => boolean;
    /**
     * Decides per row whether the note's path is shown under its title, overriding
     * {@link searchResultsLayout}. Only the display is affected: the path is still *resolved* flat,
     * so links keep addressing the note directly.
     */
    showNotePath?: (note: FNote) => boolean;
    /** Overrides how many levels start expanded, otherwise read from the parent's `#expanded`. */
    expandDepth?: number;
    /** Overrides the number of notes per page, otherwise read from the parent's `#pageSize`. */
    pageSize?: number;
    /** Rendered on the title row in place of the note's attributes. */
    renderItemActions?: (note: FNote) => ComponentChildren;
    /** Rendered in place of the item's "..." menu, for lists offering their own actions. */
    renderItemMenu?: (note: FNote) => ComponentChildren;
}

export function ListView({ note, noteIds: unfilteredNoteIds, highlightedTokens, showTextRepresentation, listOptions }: ViewModeProps<{}> & { listOptions?: ListViewOptions }) {
    const labelExpandDepth = useExpansionDepth(note);
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds, listOptions?.pageSize);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const noteType = useNoteProperty(note, "type");
    const searchResultsLayout = (noteType === "search") || !!listOptions?.searchResultsLayout;
    const expandDepth = listOptions?.expandDepth ?? labelExpandDepth;

    return <NoteList note={note} viewMode="list-view" noteIds={noteIds} pagination={pagination}>
        <Card heading={listOptions?.title} className={clsx("nested-note-list", {"search-results": searchResultsLayout})}>
            {pageNotes?.map(childNote => (
                <ListNoteCard
                    key={childNote.noteId}
                    note={childNote} parentNote={note}
                    expandDepth={expandDepth} highlightedTokens={highlightedTokens}
                    currentLevel={1} includeArchived={includeArchived}
                    searchResultsLayout={searchResultsLayout}
                    hideSubNotes={listOptions?.hideSubNotes}
                    resolveChildren={listOptions?.resolveChildren}
                    showPreview={listOptions?.showPreview}
                    showNotePath={listOptions?.showNotePath}
                    renderItemActions={listOptions?.renderItemActions}
                    renderItemMenu={listOptions?.renderItemMenu}
                    showTextRepresentation={showTextRepresentation} />
            ))}
        </Card>
    </NoteList>;
}

export function GridView({ note, noteIds: unfilteredNoteIds, highlightedTokens, showTextRepresentation }: ViewModeProps<{}>) {
    const noteIds = useFilteredNoteIds(note, unfilteredNoteIds);
    const { pageNotes, ...pagination } = usePagination(note, noteIds);
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const noteType = useNoteProperty(note, "type");

    return <NoteList note={note} viewMode="grid-view" noteIds={noteIds} pagination={pagination}>
        <div className={clsx("note-list-container use-tn-links", {"search-results": (noteType === "search")})}>
            {pageNotes?.map(childNote => (
                <GridNoteCard key={childNote.noteId}
                                note={childNote}
                                parentNote={note}
                                highlightedTokens={highlightedTokens}
                                includeArchived={includeArchived}
                                showTextRepresentation={showTextRepresentation} />
            ))}
        </div>
    </NoteList>
}

interface NoteListProps {
    note: FNote,
    viewMode: "list-view" | "grid-view",
    noteIds: string[],
    pagination: PaginationContext,
    children: ComponentChildren
}

function NoteList(props: NoteListProps) {
    const noteType = useNoteProperty(props.note, "type");
    const hasCollectionProperties = ["book", "search"].includes(noteType ?? "");

    return <div className={clsx("note-list", props.viewMode)}>
        <CollectionProperties
            note={props.note}
            centerChildren={<Pager className="note-list-top-pager" {...props.pagination} />}
        />

        {props.noteIds.length > 0 && <div className="note-list-wrapper">
            {!hasCollectionProperties && <Pager {...props.pagination} />}
            
            {props.children}

            <Pager className="note-list-bottom-pager" {...props.pagination} />
        </div>}

    </div>
}

function ListNoteCard({ note, parentNote, highlightedTokens, currentLevel, expandDepth, includeArchived, showTextRepresentation, searchResultsLayout, hideSubNotes, resolveChildren, showPreview, showNotePath, renderItemActions, renderItemMenu }: {
    note: FNote,
    parentNote: FNote,
    currentLevel: number,
    expandDepth: number,
    highlightedTokens: string[] | null | undefined;
    includeArchived: boolean;
    showTextRepresentation?: boolean;
} & Pick<ListViewOptions, "searchResultsLayout" | "hideSubNotes" | "resolveChildren" | "showPreview" | "showNotePath" | "renderItemActions" | "renderItemMenu">) {

    const [ isExpanded, setExpanded ] = useState(currentLevel <= expandDepth);
    const notePath = getNotePath(parentNote, note, searchResultsLayout);
    // The hover tooltip stands in for the inline preview, so exactly one of the two is offered.
    const showsPreview = showPreview?.(note) ?? true;
    const showsNotePath = showNotePath?.(note) ?? searchResultsLayout;
    // Whether expanding would reveal anything at all. Collections always have a preview to show, so
    // only callers that suppress it can produce a row with nothing underneath.
    const isExpandable = showsPreview || hasNestedNotes(note, hideSubNotes, resolveChildren);

    // Reset expand state if switching to another note, or if user manually toggled expansion state.
    useEffect(() => setExpanded(currentLevel <= expandDepth), [ note, currentLevel, expandDepth ]);

    let subSections: JSX.Element | undefined = undefined;
    if (isExpanded) {
        subSections = <>
            {showsPreview && (
                <CardSection className="note-content-preview">
                    <NoteContent note={note}
                                 highlightedTokens={highlightedTokens}
                                 noChildrenList
                                 includeArchivedNotes={includeArchived}
                                 showTextRepresentation={showTextRepresentation} />
                </CardSection>
            )}

            {!hideSubNotes && (
                <NoteChildren
                    note={note}
                    parentNote={parentNote}
                    highlightedTokens={highlightedTokens}
                    currentLevel={currentLevel}
                    expandDepth={expandDepth}
                    searchResultsLayout={searchResultsLayout}
                    resolveChildren={resolveChildren}
                    showPreview={showPreview}
                    showNotePath={showNotePath}
                    renderItemActions={renderItemActions}
                    renderItemMenu={renderItemMenu}
                    includeArchived={includeArchived}
                />
            )}
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
                {/* Kept in the DOM when there is nothing to expand, so titles stay aligned. */}
                <span
                    className={clsx("note-expander", isExpanded ? "bx bx-chevron-down" : "bx bx-chevron-right", { "note-expander-empty": !isExpandable })}
                    onClick={isExpandable ? () => setExpanded(!isExpanded) : undefined}
                />
                <Icon className="note-icon" icon={note.getIcon()} />
                <NoteLink className="note-book-title"
                          notePath={notePath}
                          noPreview={showsPreview}
                          showNotePath={showsNotePath}
                          highlightedTokens={highlightedTokens} />
                {renderItemActions
                    ? <div className="note-list-item-actions">{renderItemActions(note)}</div>
                    : <NoteAttributes note={note} />}
                {renderItemMenu ? renderItemMenu(note) : <NoteMenuButton notePath={notePath} />}
            </h5>
        </CardSection>
    );
}

interface GridNoteCardProps {
    note: FNote;
    parentNote: FNote;
    highlightedTokens: string[] | null | undefined;
    includeArchived: boolean;
    showTextRepresentation?: boolean;
}

function GridNoteCard(props: GridNoteCardProps) {
    const notePath = getNotePath(props.parentNote, props.note);

    return (
        <CardFrame className={clsx("note-book-card", "no-tooltip-preview", "block-link", props.note.getColorClass(), {
                "archived": props.note.isArchived
             })}
             data-href={`#${notePath}`}
             data-note-id={props.note.noteId}
             onClick={(e) => link.goToLink(e)}
        >
            <h5 className={clsx("note-book-header")}>
                <Icon className="note-icon" icon={props.note.getIcon()} />
                <NoteLink className="note-book-title"
                          notePath={notePath}
                          noPreview
                          showNotePath={props.parentNote.type === "search"}
                          highlightedTokens={props.highlightedTokens}
                />
                {!props.note.isOptions() && <NoteMenuButton notePath={notePath} />}
                
            </h5>
            <NoteContent note={props.note}
                         trim
                         highlightedTokens={props.highlightedTokens}
                         includeArchivedNotes={props.includeArchived}
                         showTextRepresentation={props.showTextRepresentation}
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

export function NoteContent({ note, trim, noChildrenList, highlightedTokens, includeArchivedNotes, showTextRepresentation, interactive, onReady }: {
    note: FNote;
    trim?: boolean;
    noChildrenList?: boolean;
    highlightedTokens: string[] | null | undefined;
    includeArchivedNotes: boolean;
    showTextRepresentation?: boolean;
    /** Render live interactive type widgets (e.g. web views) instead of static previews. */
    interactive?: boolean;
    onReady?: () => void;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);

    const [ready, setReady] = useState(false);
    const [noteType, setNoteType] = useState<string>("none");
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        contentSizeObserver.observe(contentElement);

        return () => {
            contentSizeObserver.unobserve(contentElement);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Tracks the rendered content so the cleanup can unmount any interactive widget it carries
        // (collections, web views) — otherwise their standalone Preact roots leak when the note
        // changes or the card unmounts.
        let rendered: JQuery<HTMLElement> | undefined;
        setReady(false);
        content_renderer.getRenderedContent(note, {
            trim,
            noChildrenList,
            // The note list is a lightweight preview: don't render included notes at all.
            noIncludedNotes: true,
            includeArchivedNotes,
            showTextRepresentation,
            interactive
        })
            .then(({ $renderedContent, type }) => {
                if (cancelled || !contentRef.current) {
                    // Superseded by a newer render or unmounted while rendering — tear down what was
                    // just mounted instead of letting it leak (and don't clobber newer content).
                    content_renderer.disposeInteractiveContent($renderedContent);
                    return;
                }
                rendered = $renderedContent;
                if ($renderedContent[0].innerHTML) {
                    contentRef.current.replaceChildren(...$renderedContent);
                } else {
                    contentRef.current.replaceChildren();
                }
                highlightSearch(contentRef.current);
                setNoteType(type);
                setReady(true);
                onReadyRef.current?.();
            })
            .catch(e => {
                if (cancelled) return;
                console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
                console.error(e);
                contentRef.current?.replaceChildren(t("collections.rendering_error"));
                setReady(true);
                onReadyRef.current?.();
            });
        return () => {
            cancelled = true;
            if (rendered) {
                content_renderer.disposeInteractiveContent(rendered);
            }
        };
    }, [ note, highlightedTokens ]);

    return <div ref={contentRef} className={clsx("note-book-content", `type-${noteType}`, {"note-book-content-ready": ready})} />;
}

function NoteChildren({ note, parentNote, highlightedTokens, currentLevel, expandDepth, includeArchived, searchResultsLayout, resolveChildren, showPreview, showNotePath, renderItemActions, renderItemMenu }: {
    note: FNote,
    parentNote: FNote,
    currentLevel: number,
    expandDepth: number,
    highlightedTokens: string[] | null | undefined
    includeArchived: boolean;
} & Pick<ListViewOptions, "searchResultsLayout" | "resolveChildren" | "showPreview" | "showNotePath" | "renderItemActions" | "renderItemMenu">) {
    const [ childNotes, setChildNotes ] = useState<FNote[]>();

    useEffect(() => {
        if (resolveChildren) {
            setChildNotes(resolveChildren(note));
            return;
        }

        filterChildNotes(note, includeArchived).then(setChildNotes);
    }, [ note, includeArchived, resolveChildren ]);

    return childNotes?.map(childNote => <ListNoteCard
        key={childNote.noteId}
        note={childNote}
        parentNote={parentNote}
        highlightedTokens={highlightedTokens}
        currentLevel={currentLevel + 1} expandDepth={expandDepth}
        includeArchived={includeArchived}
        searchResultsLayout={searchResultsLayout}
        resolveChildren={resolveChildren}
        showPreview={showPreview}
        showNotePath={showNotePath}
        renderItemActions={renderItemActions}
        renderItemMenu={renderItemMenu}
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

/**
 * Whether a row has nested notes to reveal, decided synchronously so the expander can be hidden
 * before the children are fetched.
 *
 * Falls back to the note's own children, which is a slight over-estimate: {@link filterChildNotes}
 * later drops image links and (when excluded) archived notes, so a note whose only children are of
 * that kind still offers an expander.
 */
function hasNestedNotes(note: FNote, hideSubNotes?: boolean, resolveChildren?: ListViewOptions["resolveChildren"]) {
    if (hideSubNotes) return false;
    if (resolveChildren) return resolveChildren(note).length > 0;

    return note.hasChildren();
}

export function getNotePath(parentNote: FNote, childNote: FNote, flat = parentNote.type === "search") {
    if (flat) {
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

function onContentResized(entries: ResizeObserverEntry[], observer: ResizeObserver): void {
    for (const contentElement of entries) {
        const isOverflowing = ((contentElement.target.scrollHeight > contentElement.target.clientHeight))
        contentElement.target.classList.toggle("note-book-content-overflowing", isOverflowing);
    }
}