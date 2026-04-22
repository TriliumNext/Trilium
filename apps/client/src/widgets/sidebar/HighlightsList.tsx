import { CKTextEditor, ModelText } from "@triliumnext/ckeditor5";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import { useActiveNoteContext, useContentElement, useIsNoteReadOnly, useMathRendering, useNoteProperty, useTextEditor, useTriliumOptionJson } from "../react/hooks";
import Modal from "../react/Modal";
import RawHtml from "../react/RawHtml";
import { HighlightsListOptions } from "../type_widgets/options/text_notes";
import RightPanelWidget from "./RightPanelWidget";

interface RawHighlight {
    id: string;
    text: string;
    attrs: {
        bold: boolean;
        italic: boolean;
        underline: boolean;
        color: string | undefined;
        background: string | undefined;
    }
}

export default function HighlightsList() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);

    return (
        <>
            {noteType === "text" && isReadOnly && <ReadOnlyTextHighlightsList />}
            {noteType === "text" && !isReadOnly && <EditableTextHighlightsList />}
        </>
    );
}

function HighlightListOptionsModal({ shown, setShown }: { shown: boolean, setShown(value: boolean): void }) {
    return (
        <Modal
            className="highlights-list-options-modal"
            size="md"
            title={t("highlights_list_2.modal_title")}
            show={shown}
            onHidden={() => setShown(false)}
        >
            <HighlightsListOptions />
        </Modal>
    );
}

function AbstractHighlightsList<T extends RawHighlight>({ highlights, scrollToHighlight }: {
    highlights: T[],
    scrollToHighlight(highlight: T): void;
}) {
    const [ highlightsList ] = useTriliumOptionJson<["bold" | "italic" | "underline" | "color" | "bgColor"]>("highlightsList");
    const highlightsListSet = new Set(highlightsList || []);
    const filteredHighlights = highlights.filter(highlight => {
        const { attrs } = highlight;
        return (
            (highlightsListSet.has("bold") && attrs.bold) ||
            (highlightsListSet.has("italic") && attrs.italic) ||
            (highlightsListSet.has("underline") && attrs.underline) ||
            (highlightsListSet.has("color") && !!attrs.color) ||
            (highlightsListSet.has("bgColor") && !!attrs.background)
        );
    });

    const [ shown, setShown ] = useState(false);
    return (
        <>
            <RightPanelWidget
                id="highlights"
                title={t("highlights_list_2.title_with_count", { count: filteredHighlights.length })}
                contextMenuItems={[
                    {
                        title: t("highlights_list_2.menu_configure"),
                        uiIcon: "bx bx-cog",
                        handler: () => setShown(true)
                    }
                ]}
                grow
            >
                <span className="highlights-list">
                    {filteredHighlights.length > 0 ? (
                        <ol>
                            {filteredHighlights.map(highlight => (
                                <HighlightItem
                                    key={highlight.id}
                                    highlight={highlight}
                                    onClick={() => scrollToHighlight(highlight)}
                                />
                            ))}
                        </ol>
                    ) : (
                        <div className="no-highlights">
                            {t("highlights_list_2.no_highlights")}
                        </div>
                    )}
                </span>
            </RightPanelWidget>
            {createPortal(<HighlightListOptionsModal shown={shown} setShown={setShown} />, document.body)}
        </>
    );
}

function HighlightItem<T extends RawHighlight>({ highlight, onClick }: {
    highlight: T;
    onClick(): void;
}) {
    const contentRef = useRef<HTMLElement>(null);

    useMathRendering(contentRef, [highlight.text]);

    return (
        <li onClick={onClick}>
            <RawHtml
                containerRef={contentRef}
                style={{
                    fontWeight: highlight.attrs.bold ? "700" : undefined,
                    fontStyle: highlight.attrs.italic ? "italic" : undefined,
                    textDecoration: highlight.attrs.underline ? "underline" : undefined,
                    color: highlight.attrs.color,
                    backgroundColor: highlight.attrs.background
                }}
                html={highlight.text}
            />
        </li>
    );
}

//#region Editable text (CKEditor)
interface CKHighlight extends RawHighlight {
    textNode: ModelText;
    offset: number | null;
}

function EditableTextHighlightsList() {
    const { note, noteContext } = useActiveNoteContext();
    const textEditor = useTextEditor(noteContext);
    const [ highlights, setHighlights ] = useState<CKHighlight[]>([]);

    useEffect(() => {
        if (!textEditor) return;
        setHighlights(extractHighlightsFromTextEditor(textEditor));

        // React to changes.
        const changeCallback = () => {
            const changes = textEditor.model.document.differ.getChanges();
            const affectsHighlights = changes.some(change => {
                // Text inserted or removed
                if (change.type === 'insert' || change.type === 'remove') {
                    return true;
                }

                // Formatting attribute changed
                if (change.type === 'attribute' &&
                    (
                        change.attributeKey === 'bold' ||
                        change.attributeKey === 'italic' ||
                        change.attributeKey === 'underline' ||
                        change.attributeKey === 'fontColor' ||
                        change.attributeKey === 'fontBackgroundColor'
                    )
                ) {
                    return true;
                }

                return false;
            });

            if (affectsHighlights) {
                setHighlights(extractHighlightsFromTextEditor(textEditor));
            }
        };

        textEditor.model.document.on("change:data", changeCallback);
        return () => textEditor.model.document.off("change:data", changeCallback);
    }, [ textEditor, note ]);

    const scrollToHeading = useCallback((highlight: CKHighlight) => {
        if (!textEditor) return;

        const modelPos = textEditor.model.createPositionAt(highlight.textNode, "before");
        const viewPos = textEditor.editing.mapper.toViewPosition(modelPos);
        const domConverter = textEditor.editing.view.domConverter;
        const domPos = domConverter.viewPositionToDom(viewPos);

        if (!domPos) return;
        if (domPos.parent instanceof HTMLElement) {
            domPos.parent.scrollIntoView();
        } else if (domPos.parent instanceof Text) {
            domPos.parent.parentElement?.scrollIntoView();
        }

    }, [ textEditor ]);

    return <AbstractHighlightsList
        highlights={highlights}
        scrollToHighlight={scrollToHeading}
    />;
}

function extractHighlightsFromTextEditor(editor: CKTextEditor) {
    const result: CKHighlight[] = [];
    const root = editor.model.document.getRoot();
    if (!root) return [];

    for (const { item } of editor.model.createRangeIn(root).getWalker({ ignoreElementEnd: true })) {
        if (!item.is('$textProxy') || !item.data.trim()) continue;

        const attrs: RawHighlight["attrs"] = {
            bold: item.hasAttribute('bold'),
            italic: item.hasAttribute('italic'),
            underline: item.hasAttribute('underline'),
            color: item.getAttribute('fontColor') as string | undefined,
            background: item.getAttribute('fontBackgroundColor') as string | undefined
        };

        if (Object.values(attrs).some(Boolean)) {
            // Get HTML content from DOM (includes nested elements like math)
            let html = item.data;
            try {
                const modelPos = editor.model.createPositionAt(item.textNode, "before");
                const viewPos = editor.editing.mapper.toViewPosition(modelPos);
                const domPos = editor.editing.view.domConverter.viewPositionToDom(viewPos);
                if (domPos?.parent instanceof HTMLElement) {
                    // Get the formatting span's innerHTML (includes math elements)
                    html = domPos.parent.innerHTML;
                }
            } catch {
                // During change:data events, the view may not be fully synchronized with the model.
                // Fall back to using the raw text data.
            }

            result.push({
                id: randomString(),
                text: html,
                attrs,
                textNode: item.textNode,
                offset: item.startOffset
            });
        }
    }

    return result;
}
//#endregion

//#region Read-only text
interface DomHighlight extends RawHighlight {
    element: HTMLElement;
}

function ReadOnlyTextHighlightsList() {
    const { noteContext } = useActiveNoteContext();
    const contentEl = useContentElement(noteContext);
    const highlights = extractHighlightsFromStaticHtml(contentEl);

    const scrollToHighlight = useCallback((highlight: DomHighlight) => {
        highlight.element.scrollIntoView();
    }, []);

    return <AbstractHighlightsList
        highlights={highlights}
        scrollToHighlight={scrollToHighlight}
    />;
}

export function extractHighlightsFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const highlights: DomHighlight[] = [];
    const processedElements = new Set<Element>();

    // Find all elements with inline background-color or color styles
    const styledElements = el.querySelectorAll<HTMLElement>('[style*="background-color"], [style*="color"]');

    for (const styledEl of styledElements) {
        if (processedElements.has(styledEl)) continue;
        if (!styledEl.textContent?.trim()) continue;

        const attrs: RawHighlight["attrs"] = {
            bold: !!styledEl.closest("strong"),
            italic: !!styledEl.closest("em"),
            underline: !!styledEl.closest("u"),
            background: styledEl.style.backgroundColor,
            color: styledEl.style.color
        };

        if (Object.values(attrs).some(Boolean)) {
            processedElements.add(styledEl);

            highlights.push({
                id: randomString(),
                text: styledEl.innerHTML,
                element: styledEl,
                attrs
            });
        }
    }

    // Also find bold, italic, underline elements
    const formattingElements = el.querySelectorAll<HTMLElement>("strong, em, u, b, i");

    for (const formattedEl of formattingElements) {
        // Skip if already processed or inside a processed element
        if (processedElements.has(formattedEl)) continue;
        if (Array.from(processedElements).some(processed => processed.contains(formattedEl))) continue;
        if (!formattedEl.textContent?.trim()) continue;

        const attrs: RawHighlight["attrs"] = {
            bold: formattedEl.matches("strong, b"),
            italic: formattedEl.matches("em, i"),
            underline: formattedEl.matches("u"),
            background: formattedEl.style.backgroundColor,
            color: formattedEl.style.color
        };

        if (Object.values(attrs).some(Boolean)) {
            processedElements.add(formattedEl);

            highlights.push({
                id: randomString(),
                text: formattedEl.innerHTML,
                element: formattedEl,
                attrs
            });
        }
    }

    return highlights;
}
//#endregion
