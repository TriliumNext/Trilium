import "./active_content.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../../components/app_context";
import type FNote from "../../../../entities/fnote";
import {
    buildLocationTree,
    CONTENT_CATEGORIES,
    type ContentCategory,
    type ContentSortOrder,
    findCategoryNotes,
    getDisplayedBranchId,
    isCategoryEnabled,
    type LocationNode,
    resolveProperties,
    setCategoryEnabled
} from "../../../../services/active_content";
import attributeService from "../../../../services/attributes";
import branches from "../../../../services/branches";
import debounce from "../../../../services/debounce";
import { t } from "../../../../services/i18n";
import { isMobile } from "../../../../services/utils";
import { ListView, type ListViewOptions } from "../../../collections/legacy/ListOrGridView";
import { Badge } from "../../../react/Badge";
import Dropdown from "../../../react/Dropdown";
import { FormListItem } from "../../../react/FormList";
import FormTextBox from "../../../react/FormTextBox";
import FormToggle from "../../../react/FormToggle";
import { useTriliumEvent, useTriliumOption } from "../../../react/hooks";
import NoItems from "../../../react/NoItems";
import SegmentedChoice from "../../../react/SegmentedChoice";
import OptionsPageHeader from "../components/OptionsPageHeader";
import type { ContentManagerSectionProps } from "./index";

const NOOP = () => {};

/** Long enough that a burst of typing issues one round of searches, short enough to feel immediate. */
const FILTER_DEBOUNCE_MS = 300;

/**
 * The item's "..." menu. The collection menu is replaced here because most of its entries act on a
 * note in the context of its parent, which this list is not: these notes live all over the tree.
 */
function ContentItemMenu({ note }: { note: FNote }) {
    return (
        <Dropdown
            className="active-content-item-menu"
            buttonClassName="note-book-item-menu bx bx-dots-vertical-rounded"
            hideToggleArrow noSelectButtonStyle noDropdownListStyle iconAction
            // Out of the row and into the body: nested, the open menu would still count as hovering
            // the row, leaving it highlighted while the cursor is over the menu.
            portalToBody
            title={t("content_manager.item_menu")}
            dropdownContainerClassName={isMobile() ? "mobile-bottom-menu" : undefined}
        >
            <FormListItem
                icon="bx bx-link-external"
                onClick={() => void appContext.tabManager.openContextWithNote(note.noteId, {
                    hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null
                })}
            >{t("link_context_menu.open_note_in_new_tab")}</FormListItem>

            <FormListItem
                icon="bx bx-trash destructive-action-icon"
                onClick={() => {
                    const branchId = getDisplayedBranchId(note, appContext.tabManager.getActiveContextNotePath());
                    if (!branchId) return;

                    // One branch, not all of them: the dialog counts a note's *other* placements to
                    // warn about clones and offer "delete all clones", so passing every branch would
                    // zero that count and remove them all silently.
                    // `moveToParent` is off — the user is on this page, not on the note.
                    void branches.deleteNotes([ branchId ], false, false);
                }}
            >{t("tree-context-menu.delete")}</FormListItem>
        </Dropdown>
    );
}

/**
 * A row's trailing detail, all within one container so the category and the properties read as a
 * single run rather than as two groups.
 *
 * @param showCategory the category is worth stating only where the headings don't already say it.
 */
function ItemDetail({ note, category, showCategory }: {
    note: FNote,
    category: ContentCategory,
    showCategory?: boolean
}) {
    return (
        <span className="active-content-properties">
            {showCategory && (
                <Badge
                    className="active-content-badge"
                    text={t(category.titleKey)}
                    tooltip={t("content_manager.property_category")}
                />
            )}
            <ContentProperties note={note} category={category} />
        </span>
    );
}

/**
 * A note's extra detail as badges — `Hourly`, `main` — one per value.
 *
 * The value is shown rather than the property name so a row stays scannable at a glance; the name
 * ("Trigger", "Instance") is the badge's tooltip, since it is only needed once to learn the pattern.
 */
function ContentProperties({ note, category }: { note: FNote, category: ContentCategory }) {
    const properties = resolveProperties(note, category);

    if (!properties.length) return null;

    // Deliberately no container of its own: {@link ItemDetail} supplies the shared one.
    return (
        <>
            {properties.flatMap(({ titleKey, values, badge }) => badge
                ? values.map((value, index) => (
                    <Badge
                        key={`${titleKey}-${index}`}
                        className="active-content-badge"
                        text={value.titleKey ? t(value.titleKey) : value.text}
                        tooltip={t(titleKey)}
                    />
                ))
                : (
                    <span key={titleKey} className="active-content-property">
                        <strong>{t(titleKey)}:</strong>
                        {" "}
                        {values.map((value) => value.titleKey ? t(value.titleKey) : value.text).join(", ")}
                    </span>
                ))}
        </>
    );
}

/**
 * Always one category, never a note's categories merged: a note can be active content in several
 * ways at once, and one switch over all of them would overwrite the states the user didn't touch.
 */
function ContentToggle({ note, category }: { note: FNote, category: ContentCategory }) {
    const [ enabled, setEnabled ] = useState(() => isCategoryEnabled(note, category));

    // Re-sync when the row is reused for another note.
    useEffect(() => setEnabled(isCategoryEnabled(note, category)), [ note, category ]);

    // ...and when the attributes change under it. The switch holds its own optimistic state, so
    // without this it goes stale on any change it did not make itself — another row, the attribute
    // bar, or a sync.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some((attribute) => attributeService.isAffecting(attribute, note))) {
            setEnabled(isCategoryEnabled(note, category));
        }
    });

    return (
        <FormToggle
            switchOnName="" switchOffName=""
            currentValue={enabled}
            switchOnTooltip={t("content_manager.toggle_enable")}
            switchOffTooltip={t("content_manager.toggle_disable")}
            onChange={(willEnable) => {
                // Applied straight away so the switch responds before the lists are rebuilt.
                setEnabled(willEnable);
                void setCategoryEnabled(note, category, willEnable);
            }}
        />
    );
}

const LIST_OPTIONS: ListViewOptions = {
    // These notes are scattered across the tree rather than being children of this page, so they are
    // listed flat with their real location shown underneath, the way search results are.
    searchResultsLayout: true,
    hideSubNotes: true,
    // Collapsed by default: the list is meant to be scanned, and expanding reveals the note's own
    // preview rather than a subtree.
    expandDepth: 0,
    pageSize: 50
};

export default function ActiveContent({ note, sectionSwitcher }: ContentManagerSectionProps) {
    const [ sortOrder, setSortOrder ] = useTriliumOption("contentManagerSortOrder");
    const [ viewMode, setViewMode ] = useTriliumOption("contentManagerViewMode");
    const [ typedFilter, setTypedFilter ] = useState("");
    const [ appliedFilter, setAppliedFilter ] = useState("");
    const categories = useCategoryNotes(sortOrder as ContentSortOrder, appliedFilter);

    const filterRef = useRef<HTMLInputElement>(null);

    // Typing stays instant while the searches only re-run once the user pauses.
    const applyFilter = useMemo(() => debounce(setAppliedFilter, FILTER_DEBOUNCE_MS), []);
    useEffect(() => () => applyFilter.clear(), [ applyFilter ]);

    // A single token, not one per word: the query matches the typed text as one substring, so
    // splitting it would highlight words that never took part in the match.
    const highlightedTokens = useMemo(() => {
        const wanted = appliedFilter.trim();
        return wanted ? [ wanted ] : null;
    }, [ appliedFilter ]);

    const clearFilter = useCallback(() => {
        // Drop any pending debounced call, otherwise the text just cleared would be re-applied.
        applyFilter.clear();
        setTypedFilter("");
        setAppliedFilter("");
        filterRef.current?.focus();
    }, [ applyFilter ]);

    return (
        <>
            {/* In the header's own row rather than the page body, so the controls stay put as the
                list scrolls beneath them. */}
            <OptionsPageHeader actions={sectionSwitcher} below={
                <div className="active-content-toolbar">
                    <div className="input-group active-content-filter">
                        <FormTextBox
                            inputRef={filterRef}
                            placeholder={t("content_manager.filter_placeholder")}
                            currentValue={typedFilter}
                            onChange={(newValue) => {
                                setTypedFilter(newValue);
                                applyFilter(newValue);
                            }}
                        />
                        <button
                            type="button"
                            className="input-group-text input-clearer-button bx bxs-tag-x"
                            title={t("content_manager.clear_filter")}
                            onClick={clearFilter}
                        />
                    </div>
                    <span className="active-content-toolbar-label">{t("content_manager.view_mode")}</span>
                    <SegmentedChoice
                        className="content-manager-view-choice"
                        options={VIEW_MODES}
                        currentValue={viewMode}
                        onChange={(newValue) => void setViewMode(newValue)}
                    />
                    <SortOrderMenu currentValue={sortOrder} onChange={(newValue) => void setSortOrder(newValue)} />
                </div>
            } />

            <div className="active-content-list">
                <ContentList
                    pageNote={note}
                    categories={categories}
                    highlightedTokens={highlightedTokens}
                    viewMode={viewMode}
                />
            </div>
        </>
    );
}

/**
 * The same items arranged by where they live rather than by what they are, so a set of items kept
 * together — several render notes under one "Statistics" note — reads as a single feature.
 */
function LocationList({ pageNote, categories, highlightedTokens }: CategoryListProps) {
    const { rootIds, childrenByNoteId, itemsByNoteId, itemCountByNoteId } = useMemo(
        () => buildLocationView(categories),
        [ categories ]
    );

    // Stable identity: `NoteChildren` re-fetches whenever the resolver changes.
    const resolveChildren = useCallback(
        (note: FNote) => childrenByNoteId.get(note.noteId) ?? [],
        [ childrenByNoteId ]
    );

    if (!rootIds.length) return null;

    return (
        <ListView
            note={pageNote}
            notePath={pageNote.noteId}
            noteIds={rootIds}
            highlightedTokens={highlightedTokens}
            viewConfig={undefined}
            saveConfig={NOOP}
            media="screen"
            onReady={NOOP}
            listOptions={{
                ...LIST_OPTIONS,
                hideSubNotes: false,
                // Collapsed, so the tree is discovered a level at a time rather than arriving as one
                // long indented wall — the group rows carry their item counts, which is the summary
                // expanding would have given. Filtering opens it back up: matches would otherwise be
                // hidden inside collapsed groups, leaving a count with nothing to show for it.
                expandDepth: highlightedTokens ? Number.MAX_SAFE_INTEGER : 0,
                resolveChildren,
                // No inline previews: every level starts open here, so previews would push the rows
                // apart and bury the hierarchy the view exists to show. Hovering a title gives the
                // content instead, `ListView` offering the tooltip wherever the preview is absent.
                showPreview: () => false,
                // Only the grouping folders state where they sit; repeating it on each item beneath
                // would undo the grouping. An item's own path is in its hover tooltip.
                showNotePath: (note) => !itemsByNoteId.has(note.noteId),
                // Grouping folders are not active content, so they carry neither toggle nor menu —
                // just how much they hold, which is the only reason they are on screen.
                renderItemActions: (note) => {
                    const item = itemsByNoteId.get(note.noteId);

                    if (!item) {
                        return (
                            <span className="active-content-property active-content-item-count">
                                {t("content_manager.item_count", { count: itemCountByNoteId.get(note.noteId) ?? 0 })}
                            </span>
                        );
                    }

                    // One strip per category, each with its own switch: a note can be active content
                    // in several ways, and merging them into one switch would overwrite the states
                    // the user did not touch. The category is named here because the headings that
                    // would otherwise say it are gone.
                    return item.categories.map((category) => (
                        <span key={category.id} className="active-content-item-strip">
                            <ItemDetail note={note} category={category} showCategory />
                            <ContentToggle note={note} category={category} />
                        </span>
                    ));
                },
                renderItemMenu: (note) => itemsByNoteId.has(note.noteId) ? <ContentItemMenu note={note} /> : null
            }}
        />
    );
}

/** Flattens the location tree into the shape `ListView` consumes: roots, children, and item lookup. */
function buildLocationView(categories: CategoryNotes[]) {
    const itemsByNoteId = new Map<string, { note: FNote, categories: ContentCategory[] }>();

    for (const { category, notes } of categories) {
        for (const note of notes) {
            const item = itemsByNoteId.get(note.noteId) ?? { note, categories: [] };
            item.categories.push(category);
            itemsByNoteId.set(note.noteId, item);
        }
    }

    const tree = buildLocationTree([ ...itemsByNoteId.values() ].map(({ note }) => note));
    const childrenByNoteId = new Map<string, FNote[]>();
    const itemCountByNoteId = new Map<string, number>();

    /** Records a node's children and returns how many items its subtree holds, groups excluded. */
    function record(node: LocationNode): number {
        childrenByNoteId.set(node.note.noteId, node.children.map(({ note }) => note));

        const count = node.children.reduce((total, child) => total + record(child), node.isGroup ? 0 : 1);
        itemCountByNoteId.set(node.note.noteId, count);

        return count;
    }

    tree.forEach(record);

    return { rootIds: tree.map(({ note }) => note.noteId), childrenByNoteId, itemsByNoteId, itemCountByNoteId };
}

interface CategoryListProps {
    pageNote: FNote;
    categories: CategoryNotes[];
    highlightedTokens: string[] | null;
}

/** Handles the states both views share, then hands the results to the chosen one. */
function ContentList({ pageNote, categories, highlightedTokens, viewMode }: {
    pageNote: FNote,
    categories: CategoryNotes[] | null,
    /** The filter text, so matches stand out in each row's title and path. `null` when not filtering. */
    highlightedTokens: string[] | null,
    viewMode: string
}) {
    if (!categories) {
        return <p className="active-content-loading">{t("content_manager.loading")}</p>;
    }

    const populated = categories.filter(({ notes }) => notes.length > 0);

    if (!populated.length) {
        // An empty result means something different while filtering: content may well exist, just
        // none of it matching, so the "nothing here yet" hint would be misleading.
        return highlightedTokens
            ? <NoItems icon="bx bx-search" text={t("content_manager.no_matches")} />
            : (
                <NoItems icon="bx bx-package" text={t("content_manager.no_items")}>
                    <small>{t("content_manager.no_items_hint")}</small>
                </NoItems>
            );
    }

    const List = viewMode === "location" ? LocationList : CategoryList;

    return <List pageNote={pageNote} categories={populated} highlightedTokens={highlightedTokens} />;
}

function CategoryList({ pageNote, categories, highlightedTokens }: CategoryListProps) {
    return (
        <>
            {categories.map(({ category, notes }) => (
                <ListView
                    key={category.id}
                    note={pageNote}
                    notePath={pageNote.noteId}
                    noteIds={notes.map(({ noteId }) => noteId)}
                    highlightedTokens={highlightedTokens}
                    viewConfig={undefined}
                    saveConfig={NOOP}
                    media="screen"
                    onReady={NOOP}
                    listOptions={{
                        ...LIST_OPTIONS,
                        title: t(category.titleKey),
                        renderItemActions: (note) => (
                            <>
                                <ItemDetail note={note} category={category} />
                                <ContentToggle note={note} category={category} />
                            </>
                        ),
                        renderItemMenu: (note) => <ContentItemMenu note={note} />
                    }}
                />
            ))}
        </>
    );
}

/** A single icon rather than a labelled pair of buttons, the order being set rarely. */
function SortOrderMenu({ currentValue, onChange }: { currentValue: string, onChange: (newValue: string) => void }) {
    return (
        <Dropdown
            buttonClassName="bx bx-sort"
            hideToggleArrow noSelectButtonStyle noDropdownListStyle iconAction
            title={t("content_manager.sort_order")}
            dropdownContainerClassName={isMobile() ? "mobile-bottom-menu" : undefined}
        >
            {SORT_ORDERS.map(({ value, label }) => (
                <FormListItem key={value} checked={currentValue === value} onClick={() => onChange(value)}>
                    {label}
                </FormListItem>
            ))}
        </Dropdown>
    );
}

const SORT_ORDERS: { value: ContentSortOrder, label: string }[] = [
    { value: "title", label: t("content_manager.sort_by_title") },
    { value: "dateCreated", label: t("content_manager.sort_by_date_created") }
];

const VIEW_MODES = [
    { value: "category", label: t("content_manager.view_by_category") },
    { value: "location", label: t("content_manager.view_by_location") }
];

interface CategoryNotes {
    category: ContentCategory;
    notes: FNote[];
}

/**
 * Runs every category's query and keeps the results in sync with the note tree.
 *
 * One query per category is more requests than a single combined search would need, but it keeps
 * each category's definition self-contained and the counts stay far too small for the difference to
 * be noticeable.
 */
function useCategoryNotes(sortOrder: ContentSortOrder, titleFilter: string) {
    // `null` until the first search resolves, so the page can tell "still loading" apart from
    // "genuinely nothing to show" instead of flashing the empty state on every open.
    const [ categories, setCategories ] = useState<CategoryNotes[] | null>(null);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        const refreshed = await Promise.all(CONTENT_CATEGORIES.map(async (category) => ({
            category,
            notes: await findCategoryNotes(category, sortOrder, titleFilter)
        })));

        // Both the sort order and `entitiesReloaded` trigger a refresh, so two can be in flight at
        // once. Drop a superseded response instead of letting it repaint over newer results.
        if (requestId === latestRequest.current) {
            setCategories(refreshed);
        }
    }, [ sortOrder, titleFilter ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    // Creating, deleting or relabelling a note can add or remove entries from any category.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().length || loadResults.getNoteIds().length) {
            void refresh();
        }
    });

    return categories;
}
