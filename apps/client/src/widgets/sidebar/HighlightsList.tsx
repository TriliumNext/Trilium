import type { CKTextEditor, ModelText } from "@triliumnext/ckeditor5";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { revealElement } from "../../services/bookmark_jump";
import { t } from "../../services/i18n";
import { randomString } from "../../services/utils";
import Dropdown from "../react/Dropdown";
import { useFilterState } from "../react/filter";
import { FormListToggleableItem } from "../react/FormList";
import { useNoteProperty } from "../react/hooks/note";
import { useTriliumOptionJson } from "../react/hooks/options";
import { useContentElement, useIsNoteReadOnly, useTextEditor } from "../react/hooks/note_context";
import { useActiveNoteContext, useGetContextData } from "../react/hooks/tree";
import { useMathRendering } from "../react/hooks/content";
import { getEditorNoteId } from "../react/NoteStore";
import { HighlightedHtml } from "../react/RawHtml";
import {
    HIGHLIGHT_FORMATS, HighlightFormat
} from "../type_widgets/options/highlights_list_options";
import {
    extractHighlightsFromStaticHtml, htmlForRun, type DomHighlight, type RawHighlight
} from "./highlights_extract";
import { useOutlineFilter } from "./outline_filter";
import RightPanelWidget, { NavigatedInNote } from "./RightPanelWidget";
import SidebarHelp from "./SidebarHelp";
import { type ContentSnapshot, isPageOfNote } from "./TableOfContents";

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
        highlights={data?.highlights ?? NO_HIGHLIGHTS}
        scrollToHighlight={data?.scrollToHighlight ?? (() => {})}
    />;
}

const NO_HIGHLIGHTS: never[] = [];

function AbstractHighlightsList<T extends RawHighlight>({ highlights, scrollToHighlight }: {
    /** The highlights in document order, `null` while they are not read yet. */
    highlights: T[] | null,
    scrollToHighlight(highlight: T): void;
}) {
    const [ highlightsList, setHighlightsList ] = useTriliumOptionJson<HighlightFormat[]>("highlightsList");
    const onNavigated = useContext(NavigatedInNote);
    const tokens = useFilterState()?.tokens;

    function activate(highlight: T) {
        scrollToHighlight(highlight);
        onNavigated?.();
    }

    // The highlights of the formats the `highlightsList` option lists.
    const shownHighlights = useMemo(() => {
        const highlightsListSet = new Set(highlightsList || []);
        return highlights?.filter(highlight => {
            const { attrs } = highlight;
            return (
                (highlightsListSet.has("bold") && attrs.bold) ||
                (highlightsListSet.has("italic") && attrs.italic) ||
                (highlightsListSet.has("underline") && attrs.underline) ||
                (highlightsListSet.has("color") && !!attrs.color) ||
                (highlightsListSet.has("bgColor") && !!attrs.background)
            );
        }) ?? null;
    }, [ highlights, highlightsList ]);
    const matches = useOutlineFilter(shownHighlights, {
        section: "highlights",
        getHtml: (highlight) => highlight.text,
        activate
    });
    const rows = matches ?? shownHighlights?.map((item, index) => ({ item, index })) ?? [];

    return (
        <RightPanelWidget
            id="highlights"
            title={t("highlights_list_2.title_with_count", { count: shownHighlights?.length ?? 0 })}
            // What the list counts as a highlight is the question the card raises and the setting that
            // answers it, so the setting sits in the header rather than behind a menu holding nothing
            // else — and as a menu of its own rather than a modal, see HighlightsListMenu.
            buttons={<>
                <SidebarHelp section="highlights" />
                <HighlightsListMenu currentValue={highlightsList} onChange={setHighlightsList} />
            </>}
        >
            <span className="highlights-list">
                {rows.length > 0 && (
                    <ol>
                        {/* Keyed by position, so a new extraction updates the items in place. */}
                        {rows.map(({ item, index }) => (
                            <HighlightItem
                                key={index}
                                highlight={item}
                                tokens={tokens}
                                onClick={() => activate(item)}
                            />
                        ))}
                    </ol>
                )}
                {!matches && rows.length === 0 && (
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

function HighlightItem<T extends RawHighlight>({ highlight, tokens, onClick }: {
    highlight: T;
    /** The terms of the filter in force, painted in the text. */
    tokens?: string[];
    onClick(): void;
}) {
    const contentRef = useRef<HTMLElement>(null);

    useMathRendering(contentRef, [highlight.text]);

    return (
        <li onClick={onClick}>
            <HighlightedHtml
                highlightedTokens={tokens}
                containerRef={contentRef}
                style={{
                    fontWeight: highlight.attrs.bold ? "700" : undefined,
                    fontStyle: highlight.attrs.italic ? "italic" : undefined,
                    textDecoration: highlight.attrs.underline ? "underline" : undefined,
                    color: highlight.attrs.color,
                    backgroundColor: highlight.attrs.background,
                    // Adapted to the theme by `adaptive-colors.css`, like the note's own colors.
                    "--tn-color": highlight.attrs.color,
                    "--tn-background": highlight.attrs.background
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
    const ntxId = noteContext?.ntxId;
    const [ snapshot, setSnapshot ] = useState<ContentSnapshot<CKHighlight> | null>(null);
    // Highlights read in another split or from another note's content are not this note's.
    const highlights = snapshot && snapshot.ntxId === ntxId && snapshot.source === note?.noteId
        ? snapshot.items
        : null;

    useEffect(() => {
        if (!textEditor) return;
        const read = () => setSnapshot({
            items: extractHighlightsFromTextEditor(textEditor),
            ntxId,
            source: getEditorNoteId(textEditor)
        });

        // The editor can still hold the previous note, until this one's content arrives.
        if (getEditorNoteId(textEditor) === note?.noteId) {
            read();
        }

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
                read();
            }
        };

        textEditor.model.document.on("change:data", changeCallback);
        return () => textEditor.model.document.off("change:data", changeCallback);
    }, [ textEditor, note?.noteId, ntxId ]);

    const scrollToHeading = useCallback((highlight: CKHighlight) => {
        if (!textEditor) return;

        const modelPos = textEditor.model.createPositionAt(highlight.textNode, "before");
        const viewPos = textEditor.editing.mapper.toViewPosition(modelPos);
        const domConverter = textEditor.editing.view.domConverter;
        const domPos = domConverter.viewPositionToDom(viewPos);

        if (!domPos) return;
        const element = domPos.parent instanceof Text ? domPos.parent.parentElement : domPos.parent;
        if (element instanceof HTMLElement) {
            revealElement(element);
            element.scrollIntoView();
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
    const { note, noteContext } = useActiveNoteContext();
    const contentEl = useContentElement(noteContext);
    // The element is the active split's, but it can still show the previous blob.
    const highlights = contentEl && isPageOfNote(contentEl.dataset.blobId, note)
        ? extractHighlightsFromStaticHtml(contentEl)
        : null;

    const scrollToHighlight = useCallback((highlight: DomHighlight) => {
        revealElement(highlight.element);
        highlight.element.scrollIntoView();
    }, []);

    return <AbstractHighlightsList
        highlights={highlights}
        scrollToHighlight={scrollToHighlight}
    />;
}

//#endregion
