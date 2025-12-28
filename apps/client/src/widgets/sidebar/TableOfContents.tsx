import "./TableOfContents.css";

import { CKTextEditor, ModelElement } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import { useActiveNoteContext, useContentElement, useIsNoteReadOnly, useNoteProperty, useTextEditor } from "../react/hooks";
import Icon from "../react/Icon";
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

export default function TableOfContents() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);

    return (
        <RightPanelWidget id="toc" title={t("toc.table_of_contents")} grow>
            {((noteType === "text" && isReadOnly) || (noteType === "doc")) && <ReadOnlyTextTableOfContents />}
            {noteType === "text" && !isReadOnly && <EditableTextTableOfContents />}
        </RightPanelWidget>
    );
}

function AbstractTableOfContents<T extends RawHeading>({ headings, scrollToHeading }: {
    headings: T[];
    scrollToHeading(heading: T): void;
}) {
    const nestedHeadings = buildHeadingTree(headings);
    return (
        <span className="toc">
            {nestedHeadings.length > 0 ? (
                <ol>
                    {nestedHeadings.map(heading => <TableOfContentsHeading key={heading.id} heading={heading} scrollToHeading={scrollToHeading} />)}
                </ol>
            ) : (
                <div className="no-headings">{t("toc.no_headings")}</div>
            )}
        </span>
    );
}

function TableOfContentsHeading({ heading, scrollToHeading }: {
    heading: HeadingsWithNesting;
    scrollToHeading(heading: RawHeading): void;
}) {
    const [ collapsed, setCollapsed ] = useState(false);
    return (
        <>
            <li className={clsx(collapsed && "collapsed")}>
                {heading.children.length > 0 && (
                    <Icon
                        className="collapse-button"
                        icon="bx bx-chevron-down"
                        onClick={() => setCollapsed(!collapsed)}
                    />
                )}
                <span
                    className="item-content"
                    onClick={() => scrollToHeading(heading)}
                >{heading.text}</span>
            </li>
            {heading.children && (
                <ol>
                    {heading.children.map(heading => <TableOfContentsHeading key={heading.id} heading={heading} scrollToHeading={scrollToHeading} />)}
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
                    change.type === 'insert' || change.type === 'remove' || (change.type === 'attribute' && change.attributeKey === 'headingLevel')
                );
            });
            if (affectsHeadings) {
                setHeadings(extractTocFromTextEditor(textEditor));
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
            const text = Array.from( item.getChildren() )
                .map( c => c.is( '$text' ) ? c.data : '' )
                .join( '' );

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
            text: headingEl.textContent,
            element: headingEl
        });
    }

    return headings;
}
//#endregion
