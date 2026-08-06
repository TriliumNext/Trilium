import type { CKTextEditor, ModelText } from "@triliumnext/ckeditor5";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import Dropdown from "../react/Dropdown";
import { FormListToggleableItem } from "../react/FormList";
import { useActiveNoteContext, useContentElement, useGetContextData, useIsNoteReadOnly, useMathRendering, useNoteProperty, useTextEditor, useTriliumOptionJson } from "../react/hooks";
import RawHtml from "../react/RawHtml";
import { HIGHLIGHT_FORMATS, HighlightFormat } from "../type_widgets/options/highlights_list_options";
import { extractHighlightsFromStaticHtml, htmlForRun, type DomHighlight, type RawHighlight } from "./highlights_extract";
import RightPanelWidget from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";

/**
 * Highlights published by a type widget that renders its own content, rather than one the
 * sidebar can read out of the editor or the DOM itself (see the Markdown note type).
 */
export interface HighlightContext {
    highlights: RawHighlight[];
    scrollToHighlight(highlight: RawHighlight): void;
}

export default function HighlightsList() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);

    return (
        <>
            {noteType === "text" && isReadOnly && <ReadOnlyTextHighlightsList />}
            {noteType === "text" && !isReadOnly && <EditableTextHighlightsList />}
            {note?.isMarkdown() && <ContextDataHighlightsList />}
        </>
    );
}

/** Reads what the note's own widget published, so the source stays the widget's business. */
function ContextDataHighlightsList() {
    const data = useGetContextData("highlights");

    return <AbstractHighlightsList
        highlights={data?.highlights ?? []}
        scrollToHighlight={data?.scrollToHighlight ?? (() => {})}
    />;
}

function AbstractHighlightsList<T extends RawHighlight>({ highlights, scrollToHighlight }: {
    highlights: T[],
    scrollToHighlight(highlight: T): void;
}) {
    const [ highlightsList, setHighlightsList ] = useTriliumOptionJson<HighlightFormat[]>("highlightsList");
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

    return (
        <RightPanelWidget
            id="highlights"
            title={t("highlights_list_2.title_with_count", { count: filteredHighlights.length })}
            // What the list counts as a highlight is the question the card raises and the setting that
            // answers it, so the setting sits in the header rather than behind a menu holding nothing
            // else — and as a menu of its own rather than a modal, see HighlightsListMenu.
            buttons={<>
                <SidebarHelp section="highlights" />
                <HighlightsListMenu currentValue={highlightsList} onChange={setHighlightsList} />
            </>}
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
    );
}

/**
 * The choice of what the list counts as a highlight, offered from the card's own header.
 *
 * A menu rather than a modal, because the toggles are a filter on the list right behind them: a modal
 * covers the very thing being filtered, so the effect of a toggle is only seen once it is dismissed,
 * whereas the list stays on show under a menu and re-filters as each format is turned over.
 *
 * Which is also why the rows are {@link FormListToggleableItem}s: they stop the press reaching
 * Bootstrap's own dismiss, so the menu survives several toggles instead of closing after the first.
 */
function HighlightsListMenu({ currentValue, onChange }: {
    currentValue: HighlightFormat[];
    onChange(newValue: HighlightFormat[]): Promise<void>;
}) {
    return (
        <Dropdown
            buttonClassName="bx bx-cog"
            title={t("highlights_list_2.menu_configure")}
            iconAction
            hideToggleArrow
            noSelectButtonStyle
            // The card establishes a stacking context of its own and clips its overflow, so the menu
            // is rendered into the body to stand clear of it — as the card's help popup is.
            portalToBody
        >
            {HIGHLIGHT_FORMATS.map(({ val, titleKey, icon }) => (
                <FormListToggleableItem
                    key={val}
                    icon={icon}
                    title={t(titleKey)}
                    currentValue={currentValue.includes(val)}
                    onChange={(checked) => onChange(checked
                        ? [ ...currentValue, val ]
                        : currentValue.filter((format) => format !== val))}
                />
            ))}
        </Dropdown>
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
            // Take the run's markup from the DOM, so nested content survives into the list.
            let html = item.data;
            try {
                const modelPos = editor.model.createPositionAt(item.textNode, "before");
                const viewPos = editor.editing.mapper.toViewPosition(modelPos);
                const domPos = editor.editing.view.domConverter.viewPositionToDom(viewPos);
                if (domPos?.parent instanceof HTMLElement) {
                    html = htmlForRun(domPos.parent, item.data);
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

//#endregion
