import "./TableOfContents.css";

import { attributeChangeAffectsHeading, CKTextEditor, ModelElement, type ModelNode } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import { useActiveNoteContext, useContentElement, useGetContextData, useIsNoteReadOnly, useMathRendering, useNoteProperty, useTextEditor } from "../react/hooks";
import Icon from "../react/Icon";
import RawHtml from "../react/RawHtml";
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

export default function TableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);

    return (
        <RightPanelWidget id="toc" title={t("toc.table_of_contents")} grow>
            {((noteType === "text" && isReadOnly) || (noteType === "doc")) && <ReadOnlyTextTableOfContents />}
            {noteType === "text" && !isReadOnly && <EditableTextTableOfContents />}
            {noteType === "file" && noteMime === "application/pdf" && <ContextDataTableOfContents />}
            {note?.isMarkdown() && <ContextDataTableOfContents />}
        </RightPanelWidget>
    );
}

function ContextDataTableOfContents() {
    const data = useGetContextData("toc");

    return (
        <AbstractTableOfContents
            headings={data?.headings || []}
            scrollToHeading={data?.scrollToHeading || (() => {})}
            activeHeadingId={data?.activeHeadingId}
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

    useMathRendering(contentRef, [heading.text]);

    return (
        <>
            <li className={clsx(collapsed && "collapsed", isActive && "active")}>
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
    const headings = extractTocFromStaticHtml(contentEl);

    const scrollToHeading = useCallback((heading: DomHeading) => {
        heading.element.scrollIntoView();
    }, []);

    return <AbstractTableOfContents
        headings={headings}
        scrollToHeading={scrollToHeading}
    />;
}

function extractTocFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const headings: DomHeading[] = [];
    for (const headingEl of el.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6")) {
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
