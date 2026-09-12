import "./active_content.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
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
} from "../../../services/active_content";
import attributeService from "../../../services/attributes";
import branches from "../../../services/branches";
import debounce from "../../../services/debounce";
import { t } from "../../../services/i18n";
import treeService from "../../../services/tree";
import { isMobile } from "../../../services/utils";
import { ListView, type ListViewOptions } from "../../collections/legacy/ListOrGridView";
import { Badge } from "../../react/Badge";
import Dropdown from "../../react/Dropdown";
import { FormListHeader, FormListItem, FormListToggleableItem } from "../../react/FormList";
import FormTextBox from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useTriliumEvent, useTriliumOption } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import SegmentedChoice from "../../react/SegmentedChoice";
import type { TypeWidgetProps } from "../type_widget";
import OptionsPageHeader from "./components/OptionsPageHeader";

const NOOP = () => {};

/** Long enough that a burst of typing issues one round of searches, short enough to feel immediate. */
const FILTER_DEBOUNCE_MS = 300;

/**
 * The item's "..." menu. The collection menu is replaced here because most of its entries act on a
 * note in the context of its parent, which this list is not: these notes live all over the tree.
 */
function ContentItemMenu({ note, categories }: { note: FNote, categories: ContentCategory[] }) {
    return (
        <Dropdown
            className="active-content-item-menu"
            buttonClassName="note-book-item-menu bx bx-dots-vertical-rounded"
            hideToggleArrow noSelectButtonStyle noDropdownListStyle iconAction
            // Out of the row and into the body: nested, the open menu would still count as hovering
            // the row, leaving it highlighted while the cursor is over the menu.
            portalToBody
            // Asked for as a sheet rather than dressed as one: the prop brings the cover over the
            // rest of the screen with it, which the class alone does not.
            mobileBottomSheet
            title={t("content_manager.item_menu")}
        >
            {isMobile() && (
                <FormListHeader text={<ItemSummary note={note} categories={categories} />} />
            )}

            {/* Only where the row's single switch has more than one thing to say: with one category
                the switch beside the name already is this, and repeating it would only ask which of
                the two is the real one. */}
            {isMobile() && categories.length > 1 && categories.map((category) => (
                <CategoryToggleItem key={category.id} note={note} category={category} />
            ))}

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
 * One category of a note that is active content in several, offered in its menu because the row's
 * own switch speaks for all of them at once and so cannot turn just one off.
 */
function CategoryToggleItem({ note, category }: { note: FNote, category: ContentCategory }) {
    const [ enabled, setEnabled ] = useState(() => isCategoryEnabled(note, category));

    useEffect(() => setEnabled(isCategoryEnabled(note, category)), [ note, category ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const rows = loadResults.getAttributeRows();
        if (rows.some((attr) => attributeService.isAffecting(attr, note))) {
            setEnabled(isCategoryEnabled(note, category));
        }
    });

    return (
        <FormListToggleableItem
            title={t(category.titleKey)}
            currentValue={enabled}
            onChange={(willEnable) => {
                setEnabled(willEnable);
                return setCategoryEnabled(note, category, willEnable);
            }}
        />
    );
}

/**
 * What the row has no width for on a phone: where the note lives, and what makes it active content.
 * Shown at the head of the item's own menu, which is one tap away either way.
 */
function ItemSummary({ note, categories }: { note: FNote, categories: ContentCategory[] }) {
    const [ location, setLocation ] = useState<string>();

    // Resolved rather than read: a path is a chain of ids, and the titles behind them may not be
    // loaded. Only runs once the menu is opened, its contents being built no sooner.
    useEffect(() => {
        const segments = note.getBestNotePath();
        segments.pop();
        void treeService.getNotePathTitle(segments.join("/")).then(setLocation);
    }, [ note ]);

    return (
        <span className="active-content-item-summary">
            {location && <span className="active-content-item-location">{location}</span>}
            {/* Under the path rather than over it: the path reads as the heading of the menu, and
                the name says which of the notes in it this menu belongs to. */}
            <span className="active-content-item-name">{note.title}</span>
            {categories.map((category) => (
                <ItemDetail key={category.id} note={note} category={category} showCategory />
            ))}
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
/**
 * The switch a note is turned on and off by, for one of its categories or for every one at once.
 *
 * Handed several, it reads as on while any of them is and writes the same state to all: a phone's
 * row has width for one switch, not for a column of them. What that cannot say, a switch per
 * category in the item's own menu can (see {@link ContentItemMenu}).
 */
function ContentToggle({ note, categories }: { note: FNote, categories: ContentCategory[] }) {
    const isOn = useCallback(
        () => categories.some((category) => isCategoryEnabled(note, category)),
        [ note, categories ]
    );
    const [ enabled, setEnabled ] = useState(isOn);

    // Re-sync when the row is reused for another note.
    useEffect(() => setEnabled(isOn()), [ isOn ]);

    // ...and when the attributes change under it. The switch holds its own optimistic state, so
    // without this it goes stale on any change it did not make itself — another row, the attribute
    // bar, or a sync.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some((attribute) => attributeService.isAffecting(attribute, note))) {
            setEnabled(isOn());
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
                for (const category of categories) {
                    void setCategoryEnabled(note, category, willEnable);
                }
            }}
        />
    );
}

const LIST_OPTIONS: ListViewOptions = {
    // These notes are scattered across the tree rather than being children of this page, so they are
    // listed flat with their real location shown underneath, the way search results are.
    searchResultsLayout: true,
    // On a phone the row has width for the name and the switch and nothing else, so where the note
    // lives moves into its menu (see `ItemSummary`) rather than being cut short under the title.
    showNotePath: () => !isMobile(),
    hideSubNotes: true,
    // Collapsed by default: the list is meant to be scanned, and expanding reveals the note's own
    // preview rather than a subtree.
    expandDepth: 0,
    pageSize: 50
};

export default function ActiveContent({ note }: TypeWidgetProps) {
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
            <OptionsPageHeader below={
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
                        className="active-content-view-choice"
                        options={VIEW_MODES}
                        currentValue={viewMode}
                        onChange={(newValue) => void setViewMode(newValue)}
                        // Two named choices are wider than the row a phone has for them, and they
                        // sit beside a filter box that needs what is left.
                        collapseOnMobile
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
                // would undo the grouping. An item's own path is in its hover tooltip, and on a
                // phone in its menu. A folder has neither, so it keeps its path at every width.
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

                    // A strip per category, each with its own switch: a note can be active content
                    // in several ways, and one switch for the lot cannot say which of them is on.
                    // The category is named here because the headings that would otherwise say it
                    // are gone.
                    if (!isMobile()) {
                        return item.categories.map((category) => (
                            <span key={category.id} className="active-content-item-strip">
                                <ItemDetail note={note} category={category} showCategory />
                                <ContentToggle note={note} categories={[ category ]} />
                            </span>
                        ));
                    }

                    // A phone's row has width for one switch, which turns the whole note off. Which
                    // categories it is on under is said in its menu, a switch each.
                    return <ContentToggle note={note} categories={item.categories} />;
                },
                renderItemMenu: (note) => {
                    const item = itemsByNoteId.get(note.noteId);
                    if (!item) return null;
                    return <ContentItemMenu note={note} categories={item.categories} />;
                }
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
                                {!isMobile() && <ItemDetail note={note} category={category} />}
                                <ContentToggle note={note} categories={[ category ]} />
                            </>
                        ),
                        renderItemMenu: (note) => (
                            <ContentItemMenu note={note} categories={[ category ]} />
                        )
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
            mobileBottomSheet
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
