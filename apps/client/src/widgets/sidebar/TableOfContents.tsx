import "./TableOfContents.css";

import type { CKTextEditor, ModelElement, ModelNode } from "@triliumnext/ckeditor5";
import { resolveBlockReference } from "@triliumnext/commons/src/lib/block_reference.js";
import clsx from "clsx";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import { revealElement } from "../../services/bookmark_jump";
import { t } from "../../services/i18n";
import type { LinkTarget } from "../../services/link_targets";
import { randomString } from "../../services/utils";
import { useLongPressContextMenu } from "../react/hooks/dom";
import { useNoteProperty } from "../react/hooks/note";
import { useContentElement, useIsNoteReadOnly, useTextEditor } from "../react/hooks/note_context";
import { useActiveNoteContext, useGetContextData } from "../react/hooks/tree";
import { useMathRendering } from "../react/hooks/content";
import Icon from "../react/Icon";
import { getEditorNoteId } from "../react/NoteStore";
import RawHtml from "../react/RawHtml";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";

//#region Generic impl.
export interface RawHeading {
    id: string;
    level: number;
    text: string;
}

interface HeadingsWithNesting extends RawHeading {
    /** The heading that the source published, which `HeadingLinks.getTarget()` takes. */
    source: RawHeading;
    children: HeadingsWithNesting[];
}

export interface HeadingContext {
    scrollToHeading(heading: RawHeading): void;
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
}

export default function TableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);

    return (
        <RightPanelWidget id="toc" title={t("toc.table_of_contents")} grow>
            {noteType === "text" && isReadOnly && <ReadOnlyTextTableOfContents />}
            {noteType === "text" && !isReadOnly && <EditableTextTableOfContents />}
            {noteType === "file" && noteMime === "application/pdf" && <ContextDataTableOfContents />}
            {noteType === "llmChat" && <ContextDataTableOfContents />}
            {note?.isMarkdown() && <ContextDataTableOfContents />}
        </RightPanelWidget>
    );
}

function ContextDataTableOfContents() {
    const { note } = useActiveNoteContext();
    const data = useGetContextData("toc");

    return (
        <AbstractTableOfContents
            headings={data?.headings || []}
            scrollToHeading={data?.scrollToHeading || (() => {})}
            activeHeadingId={data?.activeHeadingId}
            note={note}
            headingLinks={data?.headingLinks}
        />
    );
}

interface AbstractTableOfContentsProps<T extends RawHeading> {
    headings: T[];
    scrollToHeading(heading: T): void;
    activeHeadingId?: string | null;
    /** The note of the headings, which names the links that the menu copies. */
    note?: FNote | null;
    headingLinks?: HeadingLinks;
}

function AbstractTableOfContents<T extends RawHeading>({
    headings, scrollToHeading, activeHeadingId, note, headingLinks
}: AbstractTableOfContentsProps<T>) {
    const tocRef = useRef<HTMLSpanElement>(null);
    const nestedHeadings = buildHeadingTree(headings);
    const openMenu = useMemo(() => (note && headingLinks
        ? (e: MouseEvent, heading: RawHeading) => openHeadingMenu(e, heading, note, headingLinks)
        : undefined), [ note, headingLinks ]);

    useEffect(() => {
        tocRef.current?.querySelector("li.active")?.scrollIntoView({
            block: "nearest",
            behavior: "smooth"
        });
    }, [activeHeadingId]);

    return (
        <span ref={tocRef} className="toc">
            {nestedHeadings.length > 0 ? (
                <ol>
                    {nestedHeadings.map(heading => (
                        <TableOfContentsHeading
                            key={heading.id}
                            heading={heading}
                            scrollToHeading={scrollToHeading}
                            activeHeadingId={activeHeadingId}
                            openMenu={openMenu}
                        />
                    ))}
                </ol>
            ) : (
                <div className="no-headings">{t("toc.no_headings")}</div>
            )}
        </span>
    );
}

interface TableOfContentsHeadingProps {
    heading: HeadingsWithNesting;
    scrollToHeading(heading: RawHeading): void;
    activeHeadingId?: string | null;
    /** Opens the menu of a published heading. Absent where headings cannot be linked. */
    openMenu?(e: MouseEvent, heading: RawHeading): void;
}

function TableOfContentsHeading({
    heading, scrollToHeading, activeHeadingId, openMenu
}: TableOfContentsHeadingProps) {
    const [ collapsed, setCollapsed ] = useState(false);
    const onNavigated = useContext(NavigatedInNote);
    const isActive = heading.id === activeHeadingId;
    const contentRef = useRef<HTMLElement>(null);
    const menuProps = useLongPressContextMenu(useCallback((e: MouseEvent) => {
        openMenu?.(e, heading.source);
    }, [ openMenu, heading.source ]));

    useMathRendering(contentRef, [heading.text]);

    return (
        <>
            <li
                className={clsx(collapsed && "collapsed", isActive && "active")}
                {...(openMenu ? menuProps : {})}
            >
                {heading.children.length > 0 && (
                    <Icon
                        className="collapse-button"
                        icon="bx bx-chevron-down"
                        onClick={() => setCollapsed(!collapsed)}
                    />
                )}
                <RawHtml
                    containerRef={contentRef}
                    className="item-content"
                    onClick={() => {
                        scrollToHeading(heading);
                        onNavigated?.();
                    }}
                    html={heading.text}
                />
            </li>
            {heading.children.length > 0 && (
                <ol>
                    {heading.children.map(heading => (
                        <TableOfContentsHeading
                            key={heading.id}
                            heading={heading}
                            scrollToHeading={scrollToHeading}
                            activeHeadingId={activeHeadingId}
                            openMenu={openMenu}
                        />
                    ))}
                </ol>
            )}
        </>
    );
}

/** Opens the menu that copies links to `heading`, loading its commands on first use. */
function openHeadingMenu(
    e: MouseEvent, heading: RawHeading, note: FNote, headingLinks: HeadingLinks
) {
    e.preventDefault();
    void import("../../services/link_target_copy").then(({ showTargetReferenceMenu }) => {
        showTargetReferenceMenu(e, {
            note,
            getTarget: () => headingLinks.getTarget(heading),
            hasPublicLinks: headingLinks.hasPublicLinks
        });
    });
}

function buildHeadingTree(headings: RawHeading[]): HeadingsWithNesting[] {
    const rootHeading: RawHeading = { level: 0, text: "", id: "_root" };
    const root: HeadingsWithNesting = { ...rootHeading, source: rootHeading, children: [] };
    const stack: HeadingsWithNesting[] = [root];

    for (const h of headings) {
        const node: HeadingsWithNesting = { ...h, source: h, children: [] };

        // Pop until we find a parent with lower level
        while (stack.length > 1 && stack[stack.length - 1].level >= h.level) {
            stack.pop();
        }

        // Attach to current parent
        stack[stack.length - 1].children.push(node);

        // This node becomes the new parent
        stack.push(node);
    }

    return root.children;
}

export function useActiveHeading<T extends RawHeading>({ headings, scrollingContainer, getHeadingElement }: {
    headings: T[];
    scrollingContainer: HTMLElement | null;
    getHeadingElement: (heading: T) => HTMLElement | null
}) {
    const headingsRef = useRef(headings);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

    useEffect(() => {
        headingsRef.current = headings;
    }, [headings]);

    useEffect(() => {
        if (!scrollingContainer) {
            setActiveHeadingId(null);
            return;
        }

        const activeLineY = scrollingContainer.getBoundingClientRect().top + 100;
        let timeoutId: number | undefined;

        function updateActiveHeading() {
            let activeHeading: T | null = null;

            for (const heading of headingsRef.current) {
                const headingEl = getHeadingElement(heading);
                // A heading in a collapsed section has no place on the page.
                if (headingEl && !headingEl.checkVisibility({ visibilityProperty: true })) {
                    continue;
                }

                if (headingEl && headingEl.getBoundingClientRect().top <= activeLineY) {
                    activeHeading = heading;
                } else {
                    break;
                }
            }

            setActiveHeadingId(prev =>
                prev === activeHeading?.id ? prev : activeHeading?.id ?? null
            );
        }

        function handleScroll() {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(updateActiveHeading, 100);
        }

        scrollingContainer.addEventListener("scroll", handleScroll);

        updateActiveHeading();

        return () => {
            window.clearTimeout(timeoutId);
            scrollingContainer.removeEventListener("scroll", handleScroll);
        };
        // getHeadingElement must re-subscribe the listener: when a rebuild replaces the editor,
        // .scrolling-container is an ancestor of the editor root and stays the same element, so
        // scrollingContainer alone would keep the listener mapping through the destroyed editor.
    }, [scrollingContainer, getHeadingElement]);

    return activeHeadingId;
}
//#endregion

//#region Editable text (CKEditor)
/** The id of each heading element, outside the model: reading the headings must not edit the note. */
const headingIds = new WeakMap<ModelElement, string>();

interface CKHeading extends RawHeading {
    element: ModelElement;
}

function EditableTextTableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const textEditor = useTextEditor(noteContext);
    const [ headings, setHeadings ] = useState<CKHeading[]>([]);
    const [ scrollingContainer, setScrollingContainer ] = useState<HTMLElement | null>(null);

    // The CKEditor instance is reused across note switches within a tab and across the
    // read-only ↔ editable switch: the note detail keeps it mounted behind the read-only view
    // and swaps content in with `editor.setData()`, which emits `change:data`. So the editor
    // this runs against can still hold the note the user edited before, and does until this
    // note's blob arrives — a wait the auto-readonly threshold makes a long one.
    useEffect(() => {
        if (!textEditor) return;

        // `getEditorNoteId()` says whose content is in the editor. Extracting from another note's
        // would put its headings in the sidebar; the listener below picks this note's up as soon
        // as `setData()` lands.
        if (getEditorNoteId(textEditor) === note?.noteId) {
            setHeadings(extractTocFromTextEditor(textEditor));
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
                    setHeadings(extractTocFromTextEditor(textEditor));
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
    }, [ textEditor, note?.noteId ]);

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

    const activeHeadingId = useActiveHeading({ headings, scrollingContainer, getHeadingElement });

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
    const [ headings, setHeadings ] = useState<DomHeading[]>([]);
    const [ scrollingContainer, setScrollingContainer ] = useState<HTMLElement | null>(null);

    useEffect(() => {
        if (!contentEl) return;
        setHeadings(extractTocFromStaticHtml(contentEl));

        const observer = new MutationObserver(() => {
            setHeadings(extractTocFromStaticHtml(contentEl));
        });

        observer.observe(contentEl, { childList: true });

        return () => observer.disconnect();
    }, [contentEl]);

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

    const activeHeadingId = useActiveHeading({ headings, scrollingContainer, getHeadingElement });

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
