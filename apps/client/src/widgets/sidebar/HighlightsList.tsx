import { CKTextEditor, ModelText } from "@triliumnext/ckeditor5";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import { useActiveNoteContext, useContentElement, useIsNoteReadOnly, useNoteProperty, useTextEditor, useTriliumOptionJson } from "../react/hooks";
import Modal from "../react/Modal";
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
                                <li
                                    key={highlight.id}
                                    onClick={() => scrollToHighlight(highlight)}
                                >
                                    <span
                                        style={{
                                            fontWeight: highlight.attrs.bold ? "700" : undefined,
                                            fontStyle: highlight.attrs.italic ? "italic" : undefined,
                                            textDecoration: highlight.attrs.underline ? "underline" : undefined,
                                            color: highlight.attrs.color,
                                            backgroundColor: highlight.attrs.background
                                        }}
                                    >{highlight.text}</span>
                                </li>
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
            result.push({
                id: randomString(),
                text: item.data,
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

function extractHighlightsFromStaticHtml(el: HTMLElement | null) {
    if (!el) return [];

    const { color: defaultColor, backgroundColor: defaultBackgroundColor } = getComputedStyle(el);

    const walker = document.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT,
        null
    );

    const highlights: DomHighlight[] = [];

    let node: Node | null;
    while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!el || !node.textContent?.trim()) continue;

        const style = getComputedStyle(el);

        if (
            el.closest('strong, em, u') ||
            style.color !== defaultColor ||
            style.backgroundColor !== defaultBackgroundColor
        ) {
            const attrs: RawHighlight["attrs"] = {
                bold: !!el.closest("strong"),
                italic: !!el.closest("em"),
                underline: !!el.closest("u"),
                background: el.style.backgroundColor,
                color: el.style.color
            };

            if (Object.values(attrs).some(Boolean)) {
                highlights.push({
                    id: randomString(),
                    text: node.textContent,
                    element: el,
                    attrs
                });
            }
        }
    }

    return highlights;
}
//#endregion
