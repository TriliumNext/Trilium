import "./TableOfContents.css";

import { attributeChangeAffectsHeading, CKTextEditor, ModelElement, type ModelNode } from "@triliumnext/ckeditor5";
import { createPortal } from "preact/compat";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, useMemo } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import { useActiveNoteContext, useContentElement, useGetContextData, useIsNoteReadOnly, useMathRendering, useNoteProperty, useTextEditor, useTriliumOptionBool } from "../react/hooks";
import Icon from "../react/Icon";
import Modal from "../react/Modal";
import RawHtml from "../react/RawHtml";
import { TableOfContentOptions } from "../type_widgets/options/text_notes";
import RightPanelWidget from "./RightPanelWidget";

//#region Generic impl.
interface RawHeading {
    id: string;
    level: number;
    text: string;
}

interface HeadingsWithNesting extends RawHeading {
    children: HeadingsWithNesting[];
}

export interface HeadingContext {
    scrollToHeading(heading: RawHeading): void;
    headings: RawHeading[];
    activeHeadingId?: string | null;
}

function TableOfContentOptionsModal({ shown, setShown }: { shown: boolean, setShown(value: boolean): void }) {
    return (
        <Modal
            className="toc-options-modal"
            size="md"
            title={t("toc.modal_title")}
            show={shown}
            onHidden={() => setShown(false)}
        >
            <TableOfContentOptions />
        </Modal>
    );
}

export default function TableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);
    const [shown, setShown] = useState(false);

    return (
        <>
            <RightPanelWidget
                id="toc"
                title={t("toc.table_of_contents")}
                contextMenuItems={[
                    {
                        title: t("toc.menu_configure"),
                        uiIcon: "bx bx-cog",
                        handler: () => setShown(true)
                    }
                ]}
                grow
            >
                {((noteType === "text" && isReadOnly) || (noteType === "doc")) && <ReadOnlyTextTableOfContents />}
                {noteType === "text" && !isReadOnly && <EditableTextTableOfContents />}
                {noteType === "file" && noteMime === "application/pdf" && <ContextDataTableOfContents />}
                {note?.isMarkdown() && <ContextDataTableOfContents />}
            </RightPanelWidget>
            {createPortal(<TableOfContentOptionsModal shown={shown} setShown={setShown} />, document.body)}
        </>
    );
}

function ContextDataTableOfContents() {
    const data = useGetContextData("toc");
    const [tocActiveHeadingEnabled] = useTriliumOptionBool("tocActiveHeadingEnabled");

    return (
        <AbstractTableOfContents
            headings={data?.headings || []}
            scrollToHeading={data?.scrollToHeading || (() => { })}
            activeHeadingId={tocActiveHeadingEnabled ? data?.activeHeadingId : null}
        />
    );
}

function AbstractTableOfContents<T extends RawHeading>({ headings, scrollToHeading, activeHeadingId }: {
    headings: T[];
    scrollToHeading(heading: T): void;
    activeHeadingId?: string | null;
}) {
    const nestedHeadings = buildHeadingTree(headings);
    return (
        <span className="toc">
            {nestedHeadings.length > 0 ? (
                <ol>
                    {nestedHeadings.map(heading => <TableOfContentsHeading key={heading.id} heading={heading} scrollToHeading={scrollToHeading} activeHeadingId={activeHeadingId} />)}
                </ol>
            ) : (
                <div className="no-headings">{t("toc.no_headings")}</div>
            )}
        </span>
    );
}

function TableOfContentsHeading({ heading, scrollToHeading, activeHeadingId }: {
    heading: HeadingsWithNesting;
    scrollToHeading(heading: RawHeading): void;
    activeHeadingId?: string | null;
}) {
    const [ collapsed, setCollapsed ] = useState(false);
    const isActive = heading.id === activeHeadingId;
    const contentRef = useRef<HTMLElement>(null);
    const itemRef = useRef<HTMLLIElement>(null);

    useEffect(() => {
        if (isActive) {
            itemRef.current?.scrollIntoView({
                block: "nearest",
                behavior: "smooth"
            });
        }
    }, [isActive]);

    useMathRendering(contentRef, [heading.text]);

    return (
        <>
            <li ref={itemRef} className={clsx(collapsed && "collapsed", isActive && "active")}>
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
                    onClick={() => scrollToHeading(heading)}
                    html={heading.text}
                />
            </li>
            {heading.children.length > 0 && (
                <ol>
                    {heading.children.map(heading => <TableOfContentsHeading key={heading.id} heading={heading} scrollToHeading={scrollToHeading} activeHeadingId={activeHeadingId} />)}
                </ol>
            )}
        </>
    );
}

function buildHeadingTree(headings: RawHeading[]): HeadingsWithNesting[] {
    const root: HeadingsWithNesting = { level: 0, text: "", children: [], id: "_root" };
    const stack: HeadingsWithNesting[] = [root];

    for (const h of headings) {
        const node: HeadingsWithNesting = { ...h, children: [] };

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
//#endregion

//#region Editable text (CKEditor)
const TOC_ID = 'tocId';

interface CKHeading extends RawHeading {
    element: ModelElement;
}

function EditableTextTableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const textEditor = useTextEditor(noteContext);
    const [ headings, setHeadings ] = useState<CKHeading[]>([]);
    const [ tocActiveHeadingEnabled ] = useTriliumOptionBool("tocActiveHeadingEnabled");

    useEffect(() => {
        if (!textEditor) return;
        const headings = extractTocFromTextEditor(textEditor);
        setHeadings(headings);

        // React to changes.
        const changeCallback = () => {
            const changes = textEditor.model.document.differ.getChanges();

            const affectsHeadings = changes.some( change => {
                return (
                    change.type === 'insert' || change.type === 'remove' ||
                    (change.type === 'attribute' && attributeChangeAffectsHeading(change, textEditor))
                );
            });
            if (affectsHeadings) {
                requestAnimationFrame(() => {
                    setHeadings(extractTocFromTextEditor(textEditor));
                });
            }
        };

        textEditor.model.document.on("change:data", changeCallback);
        return () => textEditor.model.document.off("change:data", changeCallback);
    }, [ textEditor, note ]);

    const scrollingContainer = useMemo(() => {
        if (!tocActiveHeadingEnabled) return null;
        return textEditor?.editing.view
            .getDomRoot()
            ?.closest(".scrolling-container") as HTMLElement | null;
    }, [tocActiveHeadingEnabled, textEditor]);

    const getHeadingElement = useCallback((heading: CKHeading) => {
        if (!tocActiveHeadingEnabled) return null;

        const viewEl = textEditor?.editing.mapper.toViewElement(heading.element);
        if (!viewEl) return null;

        const domEl = textEditor?.editing.view.domConverter.mapViewToDom(viewEl);
        return domEl instanceof HTMLElement ? domEl : null;
    }, [tocActiveHeadingEnabled, textEditor]);

    const activeHeadingId = useActiveHeading({ headings, getHeadingElement, scrollingContainer });

    const scrollToHeading = useCallback((heading: CKHeading) => {
        if (!textEditor) return;

        const viewEl = textEditor.editing.mapper.toViewElement(heading.element);
        if (!viewEl) return;

        const domEl = textEditor.editing.view.domConverter.mapViewToDom(viewEl);
        domEl?.scrollIntoView();
    }, [ textEditor ]);

    return <AbstractTableOfContents
        headings={headings}
        scrollToHeading={scrollToHeading}
        activeHeadingId={activeHeadingId}
    />;
}

function extractTocFromTextEditor(editor: CKTextEditor) {
    const headings: CKHeading[] = [];

    const root = editor.model.document.getRoot();
    if (!root) return [];

    editor.model.change(writer => {
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

            // Assign a unique ID
            let tocId = item.getAttribute(TOC_ID) as string | undefined;
            if (!tocId) {
                tocId = randomString();
                writer.setAttribute(TOC_ID, tocId, item);
            }

            headings.push({ level, text, element: item, id: tocId });
        }
    });

    return headings;
}
//#endregion

//#region Read-only text
interface DomHeading extends RawHeading {
    element: HTMLHeadingElement;
}

function ReadOnlyTextTableOfContents() {
    const { noteContext } = useActiveNoteContext();
    const contentEl = useContentElement(noteContext);
    const [ headings, setHeadings ] = useState<DomHeading[]>([]);
    const [tocActiveHeadingEnabled] = useTriliumOptionBool("tocActiveHeadingEnabled");

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
        heading.element.scrollIntoView();
    }, []);

    const scrollingContainer = useMemo(() => {
        if (!tocActiveHeadingEnabled) return null;
        return contentEl?.closest(".scrolling-container") as HTMLElement | null;
    }, [contentEl, tocActiveHeadingEnabled]);

    const getHeadingElement = useCallback((heading: DomHeading) => heading.element, []);

    const activeHeadingId = useActiveHeading({ headings, getHeadingElement, scrollingContainer });

    return <AbstractTableOfContents
        headings={headings}
        scrollToHeading={scrollToHeading}
        activeHeadingId={activeHeadingId}
    />;
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

function useActiveHeading<T extends RawHeading>({ headings, scrollingContainer, getHeadingElement }: {
    headings: T[];
    getHeadingElement: (heading: T) => HTMLElement | null;
    scrollingContainer: HTMLElement | null | undefined;
}) {
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

    useEffect(() => {
        if (!scrollingContainer) return;
        const activeLineY = scrollingContainer.getBoundingClientRect().top + 200;
        let timeoutId: number | undefined;

        function updateActiveHeading() {
            let activeHeading: T | null = null;

            for (const heading of headings) {
                const headingEl = getHeadingElement(heading);

                if (headingEl && headingEl.getBoundingClientRect().top <= activeLineY) {
                    activeHeading = heading;
                } else {
                    break;
                }
            }

            setActiveHeadingId(activeHeading?.id ?? null);
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
    }, [headings, scrollingContainer, getHeadingElement]);

    return scrollingContainer ? activeHeadingId : null;
}