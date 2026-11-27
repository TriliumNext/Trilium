import "./TableOfContents.css";

import type { CKTextEditor, ModelElement, ModelNode } from "@triliumnext/ckeditor5";
import { resolveBlockReference } from "@triliumnext/commons/src/lib/block_reference.js";
import { getHeadingAncestors } from "@triliumnext/commons/src/lib/toc.js";
import clsx from "clsx";
import { createContext } from "preact";
import { memo } from "preact/compat";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import { revealElement } from "../../services/bookmark_jump";
import { t } from "../../services/i18n";
import {
    copyTargetReference, showTargetReferenceMenu, type TargetReferenceSource
} from "../../services/link_target_copy";
import type { LinkTarget } from "../../services/link_targets";
import { randomString } from "../../services/utils";
import { useFilterState } from "../react/filter";
import { useActiveHeading, useLongPressContextMenu } from "../react/hooks/dom";
import { useNoteProperty } from "../react/hooks/note";
import {
    useContentElement, useDocumentState, useIsNoteReadOnly, useTextEditor
} from "../react/hooks/note_context";
import { useActiveNoteContext, useGetContextData } from "../react/hooks/tree";
import { useMathRendering } from "../react/hooks/content";
import Icon from "../react/Icon";
import { getEditorNoteId } from "../react/NoteStore";
import RawHtml, { HighlightedHtml } from "../react/RawHtml";
import { CachedToCProvider, isServedTocFormat } from "./CachedToCProvider";
import { useOutlineFilter } from "./outline_filter";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";

//#region Generic impl.
export interface RawHeading {
    id: string;
    level: number;
    text: string;
    /** Whether no link can reach the heading: its row is muted, without click or menu. */
    isDisabled?: boolean;
}

interface HeadingsWithNesting extends RawHeading {
    /** The heading that the source published, which `HeadingLinks.getTarget()` takes. */
    source: RawHeading;
    children: HeadingsWithNesting[];
}

export interface HeadingContext {
    /** Shows `heading`. `false` tells that it showed nothing, so the pane stays where it is. */
    scrollToHeading(heading: RawHeading): boolean | void;
    headings: RawHeading[];
    activeHeadingId?: string | null;
    /** Links to the headings, for their context menu. Absent where headings cannot be linked. */
    headingLinks?: HeadingLinks;
}

/** How the outline links to the headings of the note it shows. */
export interface HeadingLinks {
    /**
     * The link target of `heading`, one of the published headings, or `null` when it cannot be
     * linked. Reading it writes nothing: the target either has `params` that are in the saved
     * note, or a `createReference()` that writes them.
     */
    getTarget(heading: RawHeading): Promise<LinkTarget | null>;
    /** Whether the shared page of the note lands on the targets, which reach it by `block`. */
    hasPublicLinks: boolean;
    /** The title that a copied reference starts with, when it is not the note's. */
    title?: string;
}

export default function TableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);
    const isCached = !!noteType && !!noteMime && isServedTocFormat(noteType, noteMime);
    // The attachment that the attachments view shows, whose outline comes from its ToC cache.
    const isAttachment = noteContext?.viewScope?.viewMode === "attachments";
    const attachmentId = isAttachment ? noteContext?.viewScope?.attachmentId : undefined;
    const collapsedHeadings = useCollapsedHeadings(`${note?.noteId}:${attachmentId ?? ""}`);

    return (
        <CollapsedHeadingsContext.Provider value={collapsedHeadings}>
            <RightPanelWidget id="toc" title={t("toc.table_of_contents")} grow>
                {attachmentId && <CachedToCProvider />}
                {!isAttachment && noteType === "text" && isReadOnly && (
                    <ReadOnlyTextTableOfContents />
                )}
                {!isAttachment && noteType === "text" && !isReadOnly && (
                    <EditableTextTableOfContents />
                )}
                {!isAttachment && isCached && <CachedToCProvider />}
                {!isAttachment && noteType === "llmChat" && <ContextDataTableOfContents />}
                {!isAttachment && note?.isMarkdown() && <ContextDataTableOfContents />}
            </RightPanelWidget>
        </CollapsedHeadingsContext.Provider>
    );
}

/** The ids of the headings that the user collapsed in the outline, and how to toggle one. */
interface CollapsedHeadings {
    ids: ReadonlySet<string>;
    toggle(id: string): void;
}

/** Provided by `TableOfContents` above the card body, so a collapse of the card keeps it. */
const CollapsedHeadingsContext = createContext<CollapsedHeadings | null>(null);

const NO_IDS: ReadonlySet<string> = new Set();

/** The headings collapsed in the outline of the document `documentKey`, none for a new one. */
function useCollapsedHeadings(documentKey: string): CollapsedHeadings {
    const [ ids, setIds ] = useDocumentState(documentKey, NO_IDS);
    const toggle = useCallback((id: string) => {
        setIds((previous) => {
            const next = new Set(previous);
            if (!next.delete(id)) {
                next.add(id);
            }
            return next;
        });
    }, [ setIds ]);

    return useMemo(() => ({ ids, toggle }), [ ids, toggle ]);
}

function ContextDataTableOfContents() {
    const { note } = useActiveNoteContext();
    const data = useGetContextData("toc");

    return (
        <AbstractTableOfContents
            headings={data?.headings ?? NO_HEADINGS}
            scrollToHeading={data?.scrollToHeading || (() => {})}
            activeHeadingId={data?.activeHeadingId}
            note={note}
            headingLinks={data?.headingLinks}
        />
    );
}

export interface AbstractTableOfContentsProps<T extends RawHeading> {
    /** The headings in document order, `null` while they are not read yet. */
    headings: T[] | null;
    /** Shows `heading`. `false` tells that it showed nothing, so the pane stays where it is. */
    scrollToHeading(heading: T): boolean | void;
    activeHeadingId?: string | null;
    /** The note of the headings, which names the links that the menu copies. */
    note?: FNote | null;
    headingLinks?: HeadingLinks;
    /** Whether no row can be clicked or opens a menu, while nothing shows the headings. */
    isInert?: boolean;
    /** Whether the headings are not the document's yet, so that a filter waits for them. */
    isLoading?: boolean;
}

const NO_HEADINGS: never[] = [];

/**
 * The outline of `headings`, a tree by level. While its tab filters, a flat list of the
 * matching headings, each with the headings it nests under.
 */
export const AbstractTableOfContents = memo(AbstractTableOfContentsList) as
    typeof AbstractTableOfContentsList;

function AbstractTableOfContentsList<T extends RawHeading>({
    headings, scrollToHeading, activeHeadingId, note, headingLinks, isInert, isLoading
}: AbstractTableOfContentsProps<T>) {
    const tocRef = useRef<HTMLSpanElement>(null);
    const onNavigated = useContext(NavigatedInNote);
    const activate = useCallback((heading: T) => {
        if (scrollToHeading(heading) !== false) {
            onNavigated?.();
        }
    }, [ scrollToHeading, onNavigated ]);
    const matches = useOutlineFilter(headings, {
        section: "toc",
        getHtml: (heading) => heading.text,
        getLevel: (heading) => heading.level,
        activate,
        canActivate: (heading) => !heading.isDisabled,
        isLoading: isLoading || isInert
    });
    const tokens = useFilterState()?.tokens;
    const isFiltered = matches !== null;
    const nestedHeadings = useMemo(() => (isFiltered ? [] : buildHeadingTree(headings ?? [])),
        [ headings, isFiltered ]);
    const ownCollapsedHeadings = useCollapsedHeadings("");
    const collapsedHeadings = useContext(CollapsedHeadingsContext) ?? ownCollapsedHeadings;
    const getReferenceSource = useMemo(() => (note && headingLinks
        ? (heading: RawHeading): TargetReferenceSource => ({
            note,
            getTarget: () => headingLinks.getTarget(heading),
            hasPublicLinks: headingLinks.hasPublicLinks,
            title: headingLinks.title
        })
        : undefined), [ note, headingLinks ]);

    useEffect(() => {
        tocRef.current?.querySelector("li.active")?.scrollIntoView({
            block: "nearest",
            behavior: "smooth"
        });
    }, [activeHeadingId]);

    const rowActivate = isInert ? undefined : activate;
    const rowReferenceSource = isInert ? undefined : getReferenceSource;
    return (
        <span ref={tocRef} className={clsx("toc", isInert && "inert")}>
            {matches && matches.length > 0 && (
                <ol className="toc-matches">
                    {matches.map(({ item, parentTexts }) => (
                        <HeadingRow
                            key={item.id}
                            heading={item}
                            activate={rowActivate}
                            isActive={item.id === activeHeadingId}
                            getReferenceSource={rowReferenceSource}
                            match={{ path: parentTexts.join(" / "), tokens: tokens ?? [] }}
                        />
                    ))}
                </ol>
            )}
            {!isFiltered && nestedHeadings.length > 0 && (
                <ol>
                    {nestedHeadings.map(heading => (
                        <TableOfContentsHeading
                            key={heading.id}
                            heading={heading}
                            activate={rowActivate}
                            activeHeadingId={activeHeadingId}
                            getReferenceSource={rowReferenceSource}
                            collapsedHeadings={collapsedHeadings}
                        />
                    ))}
                </ol>
            )}
            {!isFiltered && nestedHeadings.length === 0 && (
                <div className="no-headings">{t("toc.no_headings")}</div>
            )}
        </span>
    );
}

interface TableOfContentsHeadingProps {
    heading: HeadingsWithNesting;
    /** Shows a heading. Absent while the rows are inert. */
    activate?(heading: RawHeading): void;
    activeHeadingId?: string | null;
    /** The links to a published heading. Absent where headings cannot be linked. */
    getReferenceSource?(heading: RawHeading): TargetReferenceSource;
    collapsedHeadings: CollapsedHeadings;
}

function TableOfContentsHeading({
    heading, activate, activeHeadingId, getReferenceSource, collapsedHeadings
}: TableOfContentsHeadingProps) {
    const hasChildren = heading.children.length > 0;

    return (
        <>
            <HeadingRow
                heading={heading.source}
                activate={activate}
                isActive={heading.id === activeHeadingId}
                getReferenceSource={getReferenceSource}
                collapse={hasChildren ? {
                    isCollapsed: collapsedHeadings.ids.has(heading.id),
                    toggle: () => collapsedHeadings.toggle(heading.id)
                } : undefined}
            />
            {hasChildren && (
                <ol>
                    {heading.children.map(heading => (
                        <TableOfContentsHeading
                            key={heading.id}
                            heading={heading}
                            activate={activate}
                            activeHeadingId={activeHeadingId}
                            getReferenceSource={getReferenceSource}
                            collapsedHeadings={collapsedHeadings}
                        />
                    ))}
                </ol>
            )}
        </>
    );
}

interface HeadingRowProps {
    /** The heading as its source published it. */
    heading: RawHeading;
    /** Shows the heading. Absent while the rows are inert. */
    activate?(heading: RawHeading): void;
    isActive: boolean;
    /** The links to a published heading. Absent where headings cannot be linked. */
    getReferenceSource?(heading: RawHeading): TargetReferenceSource;
    /** In the tree, the collapse of a heading with children. */
    collapse?: { isCollapsed: boolean; toggle(): void };
    /** In the list of matches, the titles of the headings above it and the terms to paint. */
    match?: { path: string; tokens: string[] };
}

/** The row of a heading, in the tree or in the list of matches. */
function HeadingRow({
    heading, activate, isActive, getReferenceSource, collapse, match
}: HeadingRowProps) {
    const contentRef = useRef<HTMLElement>(null);
    const getSource = heading.isDisabled ? undefined : getReferenceSource;
    const menuProps = useLongPressContextMenu(useCallback((e: MouseEvent) => {
        if (!getSource) return;
        e.preventDefault();
        showTargetReferenceMenu(e, getSource(heading));
    }, [ getSource, heading ]));
    const onClick = activate && !heading.isDisabled ? () => activate(heading) : undefined;

    useMathRendering(contentRef, [heading.text]);

    return (
        <li
            className={clsx(collapse?.isCollapsed && "collapsed", isActive && "active",
                heading.isDisabled && "disabled", getSource && "linkable")}
            {...(getSource ? menuProps : {})}
        >
            {collapse && (
                <Icon
                    className="collapse-button"
                    icon="bx bx-chevron-down"
                    onClick={collapse.toggle}
                />
            )}
            {match ? (
                <span className="item-content" onClick={onClick}>
                    <HighlightedHtml
                        containerRef={contentRef}
                        className="item-title"
                        html={heading.text}
                        highlightedTokens={match.tokens}
                    />
                    {match.path && <span className="item-path">{match.path}</span>}
                </span>
            ) : (
                <RawHtml
                    containerRef={contentRef}
                    className="item-content"
                    onClick={onClick}
                    html={heading.text}
                />
            )}
            {getSource && (
                <Icon
                    className="tree-item-button"
                    icon="bx bx-copy"
                    title={t("block_reference.copy_reference")}
                    onClick={() => copyTargetReference(getSource(heading))}
                />
            )}
        </li>
    );
}

function buildHeadingTree(headings: RawHeading[]): HeadingsWithNesting[] {
    const ancestors = getHeadingAncestors(headings, (heading) => heading.level);
    const nodes = new Map<RawHeading, HeadingsWithNesting>();
    const roots: HeadingsWithNesting[] = [];
    for (const [ index, heading ] of headings.entries()) {
        const node: HeadingsWithNesting = { ...heading, source: heading, children: [] };
        nodes.set(heading, node);
        const parent = ancestors[index].at(-1);
        const siblings = parent ? nodes.get(parent)?.children : roots;
        siblings?.push(node);
    }
    return roots;
}

//#endregion

//#region Editable text (CKEditor)
/** The id of each heading element, outside the model: reading the headings must not edit the note. */
const headingIds = new WeakMap<ModelElement, string>();

interface CKHeading extends RawHeading {
    element: ModelElement;
}

/** Items read from a note's content, with the split they were read in and the content's owner. */
export interface ContentSnapshot<T> {
    items: T[];
    ntxId: string | null | undefined;
    /** The note whose content the editor held, or the blob that the page showed. */
    source: string | undefined;
}

function EditableTextTableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const textEditor = useTextEditor(noteContext);
    const ntxId = noteContext?.ntxId;
    const [ snapshot, setSnapshot ] = useState<ContentSnapshot<CKHeading> | null>(null);
    const [ scrollingContainer, setScrollingContainer ] = useState<HTMLElement | null>(null);
    // Headings read in another split or from another note's content are not this note's.
    const headings = snapshot && snapshot.ntxId === ntxId && snapshot.source === note?.noteId
        ? snapshot.items
        : null;

    // The CKEditor instance is reused across note switches within a tab and across the
    // read-only ↔ editable switch: the note detail keeps it mounted behind the read-only view
    // and swaps content in with `editor.setData()`, which emits `change:data`. So the editor
    // this runs against can still hold the note the user edited before, and does until this
    // note's blob arrives — a wait the auto-readonly threshold makes a long one.
    useEffect(() => {
        if (!textEditor) return;

        const read = () => setSnapshot({
            items: extractTocFromTextEditor(textEditor),
            ntxId,
            source: getEditorNoteId(textEditor)
        });

        // `getEditorNoteId()` says whose content is in the editor. Extracting from another note's
        // would put its headings in the sidebar; the listener below picks this note's up as soon
        // as `setData()` lands.
        if (getEditorNoteId(textEditor) === note?.noteId) {
            read();
        }

        // Attached synchronously so no `setData()` can slip past it. Only the attribute check
        // waits on the CKEditor bundle, which is statically heavy but guaranteed to be loaded by
        // now (a text editor instance exists); until it resolves, inserts and removals — which is
        // what `setData()` produces — still come through.
        let affectsHeading: typeof import("@triliumnext/ckeditor5").attributeChangeAffectsHeading | undefined;
        void import("@triliumnext/ckeditor5").then(({ attributeChangeAffectsHeading }) => {
            affectsHeading = attributeChangeAffectsHeading;
        });

        // One extraction per frame, however many changes arrive in it.
        let frame: number | undefined;
        const changeCallback = () => {
            const changes = textEditor.model.document.differ.getChanges();

            const affectsHeadings = changes.some( change => {
                return (
                    change.type === 'insert' || change.type === 'remove' ||
                    (change.type === 'attribute' && (affectsHeading?.(change, textEditor) ?? false))
                );
            });
            if (affectsHeadings && frame === undefined) {
                frame = requestAnimationFrame(() => {
                    frame = undefined;
                    read();
                });
            }
        };

        textEditor.model.document.on("change:data", changeCallback);

        return () => {
            textEditor.model.document.off("change:data", changeCallback);
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
            }
        };
    }, [ textEditor, note?.noteId, ntxId ]);

    useEffect(() => {
        if (!textEditor) {
            setScrollingContainer(null);
            return;
        }

        const container = textEditor.editing.view.getDomRoot()?.closest(".scrolling-container") as HTMLElement | null;
        setScrollingContainer(container);
    }, [textEditor]);

    const getHeadingElement = useCallback((heading: CKHeading) => {
        if (!textEditor) return null;

        const viewEl = textEditor.editing.mapper.toViewElement(heading.element);
        if (!viewEl) return null;

        const domEl = textEditor.editing.view.domConverter.mapViewToDom(viewEl);
        return domEl ?? null;
    }, [textEditor]);

    const activeHeadingId = useActiveHeading({
        headings: headings ?? NO_HEADINGS, scrollingContainer, getHeadingElement
    });

    const scrollToHeading = useCallback((heading: CKHeading) => {
        if (!textEditor) return;

        const viewEl = textEditor.editing.mapper.toViewElement(heading.element);
        if (!viewEl) return;

        const domEl = textEditor.editing.view.domConverter.mapViewToDom(viewEl);
        if (domEl) {
            revealElement(domEl);
            domEl.scrollIntoView();
        }
    }, [ textEditor ]);

    const notePath = noteContext?.notePath;
    const headingLinks = useMemo(() => (textEditor && note
        ? getEditorHeadingLinks(textEditor, note.noteId, notePath ?? note.getBestNotePathString())
        : undefined), [ textEditor, note, notePath ]);

    return <AbstractTableOfContents
        headings={headings}
        scrollToHeading={scrollToHeading}
        activeHeadingId={activeHeadingId}
        note={note}
        headingLinks={headingLinks}
    />;
}

/** Links to the headings of `editor`, which gives a heading its id before the copy. */
function getEditorHeadingLinks(
    editor: CKTextEditor, noteId: string, notePath: string
): HeadingLinks {
    return {
        async getTarget(heading) {
            const { element } = heading as CKHeading;
            if (!isShownHeading(editor, noteId, element)) return null;

            const { getHeadings, assignBlockId } = await import("@triliumnext/ckeditor5");
            const documentHeading = getHeadings(editor).find((h) => h.element === element);
            if (!documentHeading?.text) return null;

            const links = await import("../../services/link_targets");
            return links.createEditorTarget({
                noteId,
                notePath,
                title: documentHeading.text,
                level: documentHeading.level,
                assignId: () => (isShownHeading(editor, noteId, element)
                    ? assignBlockId(editor.model, element)
                    : null),
                isSaved: links.isTextHeadingId
            });
        },
        hasPublicLinks: true
    };
}

/** Whether `editor` still shows `element` of the note `noteId`, and can give it an id. */
function isShownHeading(editor: CKTextEditor, noteId: string, element: ModelElement) {
    return getEditorNoteId(editor) === noteId && !editor.isReadOnly && element.isAttached();
}

function extractTocFromTextEditor(editor: CKTextEditor) {
    const headings: CKHeading[] = [];

    const root = editor.model.document.getRoot();
    if (!root) return [];

    for (const { type, item } of editor.model.createRangeIn(root).getWalker()) {
        if (type !== "elementStart" || !item.is('element') || !item.name.startsWith('heading')) continue;

        const level = Number(item.name.replace( 'heading', '' ));

        // Convert model element to view, then to DOM to get HTML.
        // Math UIElements render their KaTeX content asynchronously, so
        // ck-math-tex spans may be empty at read time. Replace them with
        // math-tex spans (the data format) using the equation from the model,
        // so useMathRendering can render them synchronously in the sidebar.
        const viewEl = editor.editing.mapper.toViewElement(item);
        let text = '';
        if (viewEl) {
            const domEl = editor.editing.view.domConverter.mapViewToDom(viewEl);
            if (domEl instanceof HTMLElement) {
                const clone = domEl.cloneNode(true) as HTMLElement;
                const ckMathSpans = clone.querySelectorAll('.ck-math-tex');
                let mathIdx = 0;
                for (const child of item.getChildren()) {
                    if (!child.is('element', 'mathtex-inline')) continue;
                    if (mathIdx >= ckMathSpans.length) break;
                    const equation = String(child.getAttribute('equation') ?? '');
                    const span = document.createElement('span');
                    span.className = 'math-tex';
                    span.textContent = `\\(${equation}\\)`;
                    ckMathSpans[mathIdx].replaceWith(span);
                    mathIdx++;
                }
                text = clone.innerHTML;
            }
        }

        // Fallback to plain text if DOM conversion fails
        if (!text) {
            text = Array.from( item.getChildren() )
                .map( (c: ModelNode) => c.is( '$text' ) ? c.data : '' )
                .join( '' );
        }

        let id = headingIds.get(item);
        if (!id) {
            id = randomString();
            headingIds.set(item, id);
        }

        headings.push({ level, text, element: item, id });
    }

    return headings;
}
//#endregion

//#region Read-only text
interface DomHeading extends RawHeading {
    element: HTMLHeadingElement;
}

function ReadOnlyTextTableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const contentEl = useContentElement(noteContext);
    const ntxId = noteContext?.ntxId;
    const [ snapshot, setSnapshot ] = useState<ContentSnapshot<DomHeading> | null>(null);
    const [ scrollingContainer, setScrollingContainer ] = useState<HTMLElement | null>(null);
    // Headings read in another split or from another blob are not this note's.
    const headings = snapshot && snapshot.ntxId === ntxId && isPageOfNote(snapshot.source, note)
        ? snapshot.items
        : null;

    useEffect(() => {
        if (!contentEl) return;
        const read = () => setSnapshot({
            items: extractTocFromStaticHtml(contentEl),
            ntxId,
            source: contentEl.dataset.blobId
        });
        read();

        const observer = new MutationObserver(read);
        observer.observe(contentEl, { childList: true });

        return () => observer.disconnect();
    }, [ contentEl, ntxId ]);

    const scrollToHeading = useCallback((heading: DomHeading) => {
        revealElement(heading.element);
        heading.element.scrollIntoView();
    }, []);

    useEffect(() => {
        if (!contentEl) {
            setScrollingContainer(null);
            return;
        }

        const container = contentEl.closest(".scrolling-container") as HTMLElement;
        setScrollingContainer(container);
    }, [contentEl]);

    const getHeadingElement = useCallback((heading: DomHeading) => heading.element, []);

    const activeHeadingId = useActiveHeading({
        headings: headings ?? NO_HEADINGS, scrollingContainer, getHeadingElement
    });

    // Help pages take no ids and are never shared.
    const notePath = noteContext?.notePath;
    const headingLinks = useMemo(() => (contentEl && note && !note.isMetadataReadOnly
        ? getPageHeadingLinks(contentEl, note.noteId, notePath ?? note.getBestNotePathString())
        : undefined), [ contentEl, note, notePath ]);

    return <AbstractTableOfContents
        headings={headings}
        scrollToHeading={scrollToHeading}
        activeHeadingId={activeHeadingId}
        note={note}
        headingLinks={headingLinks}
    />;
}

/**
 * Links to the headings of `contentEl`, the page of a read-only note. The page parses the stored
 * HTML otherwise than the server, so the clicked heading is found by the mark that the server
 * gives it in a copy of that HTML.
 */
function getPageHeadingLinks(
    contentEl: HTMLElement, noteId: string, notePath: string
): HeadingLinks {
    return {
        async getTarget(heading) {
            const { element } = heading as DomHeading;
            const { blobId } = contentEl.dataset;
            if (!blobId || !contentEl.contains(element)) return null;

            const links = await import("../../services/link_targets");
            // The page must show the current blob of the note on the server.
            const marked = await links.getMarkedHeadings(noteId);
            if (marked.blobId !== blobId) return null;

            const shown = extractTocFromStaticHtml(contentEl).map((h) => h.element);
            const index = links.findMarkedIndex(marked, shown, element);
            const target = index === null ? undefined : marked.headings[index];
            if (index === null || !target) return null;

            const block = target.params?.block;
            if (block) {
                // A link lands on the first element of the page with the id.
                return resolveBlockReference(contentEl, block).start === element
                    ? links.createLinkedTarget(notePath, target.title, { block })
                    : null;
            }
            return links.createSavedHeadingTarget(noteId, notePath, {
                index, title: target.title, blobId
            });
        },
        hasPublicLinks: true
    };
}

/**
 * Whether a page that shows the blob `blobId` shows the content of `note`. A page that names no
 * blob is taken as the note's.
 */
export function isPageOfNote(blobId: string | undefined, note: FNote | null | undefined) {
    return blobId === undefined || blobId === note?.blobId;
}

function extractTocFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const headings: DomHeading[] = [];
    for (const headingEl of el.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6")) {
        if (headingEl.closest(".include-note")) continue;
        headings.push({
            id: randomString(),
            level: parseInt(headingEl.tagName.substring(1), 10),
            text: headingEl.innerHTML,
            element: headingEl
        });
    }

    return headings;
}
//#endregion
