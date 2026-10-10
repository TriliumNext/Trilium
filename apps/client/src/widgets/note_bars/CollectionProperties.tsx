import "./CollectionProperties.css";

import { SearchResultDetails, SearchResultDetailsResponse } from "@triliumnext/commons";
import { t } from "i18next";
import { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import dialogService from "../../services/dialog";
import server from "../../services/server";
import toast from "../../services/toast";
import { getErrorMessage, isShare } from "../../services/utils";
import { ViewTypeOptions } from "../collections/interface";
import { searchTermsFor } from "../collections/search/SearchResultCard";
import ActionButton from "../react/ActionButton";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useNoteContext, useNoteLabel, useNoteProperty, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { CheckBoxProperty, ViewProperty } from "../react/NotePropertyMenu";
import { bookPropertiesConfig } from "./collection-properties-config";

export const ICON_MAPPINGS: Record<ViewTypeOptions, string> = {
    grid: "bx bxs-grid",
    list: "bx bx-list-ul",
    calendar: "bx bx-calendar",
    table: "bx bx-table",
    geoMap: "bx bx-map-alt",
    board: "bx bx-columns",
    presentation: "bx bx-rectangle",
    dashboard: "bx bxs-dashboard"
};

export const VIEW_TYPE_MAPPINGS: Record<ViewTypeOptions, string> = {
    grid: t("book_properties.grid"),
    list: t("book_properties.list"),
    calendar: t("book_properties.calendar"),
    table: t("book_properties.table"),
    geoMap: t("book_properties.geo-map"),
    board: t("book_properties.board"),
    presentation: t("book_properties.presentation"),
    dashboard: t("book_properties.dashboard")
};

const MAX_OPEN_TABS = 50;

interface CollectionPropertiesProps {
    note: FNote;
    centerChildren?: ComponentChildren;
    rightChildren?: ComponentChildren;
    /** Entries appended below a divider at the end of the settings dropdown. */
    optionsChildren?: ComponentChildren;
}

/**
 * The bar above a collection that switches its view, sets its options and holds the view's own
 * controls, such as a calendar's navigation. A shared page keeps only the view's own controls, as a
 * visitor cannot change the note, and has no bar for a view without any.
 */
export default function CollectionProperties(props: CollectionPropertiesProps) {
    return isShare && !props.centerChildren && !props.rightChildren
        ? null
        : <CollectionPropertiesBar {...props} />;
}

function CollectionPropertiesBar({
    note,
    centerChildren,
    rightChildren,
    optionsChildren
}: CollectionPropertiesProps) {
    const [ viewType, setViewType ] = useViewType(note);
    const noteType = useNoteProperty(note, "type");
    const [ isOpening, setIsOpening ] = useState(false);

    return ([ "book", "search" ].includes(noteType ?? "") &&
        <div className="collection-properties">
            <div className="left-container">
                {!isShare && <>
                    <ViewTypeSwitcher viewType={viewType} setViewType={setViewType} />
                    <ViewOptions note={note} viewType={viewType} optionsChildren={optionsChildren} />
                </>}
            </div>
            <div className="center-container">
                {centerChildren}
            </div>
            <div className="right-container">
                {rightChildren}
                {noteType === "search" && !isShare && (
                    <OpenAllButton note={note} isOpening={isOpening} setIsOpening={setIsOpening} />
                )}
            </div>
        </div>
    );
}

function OpenAllButton({ note, isOpening, setIsOpening }: {
    note: FNote;
    isOpening: boolean;
    setIsOpening: (value: boolean) => void;
}) {
    const noteIds = note.getChildNoteIds();
    const count = noteIds.length;

    const handleOpenAll = async () => {
        if (count === 0) return;

        if (count > MAX_OPEN_TABS) {
            toast.showError(t("book_properties.open_all_limit_exceeded", { count, max: MAX_OPEN_TABS }));
            return;
        }

        if (count > 10) {
            const confirmed = await dialogService.confirm(t("book_properties.open_all_confirm", { count }));
            if (!confirmed) return;
        }

        setIsOpening(true);
        try {
            const detailsByNoteId = await getResultDetails(note, noteIds);
            const highlightedTokens = note.highlightedTokenInfos ?? note.highlightedTokens;
            for (let i = 0; i < noteIds.length; i++) {
                const noteId = noteIds[i];
                const isLast = i === noteIds.length - 1;
                const searchTerms = searchTermsFor(detailsByNoteId.get(noteId), highlightedTokens);
                await appContext.tabManager.openTabWithNoteWithHoisting(noteId, {
                    activate: isLast,
                    viewScope: searchTerms?.length ? { searchTerms } : null
                });
            }
        } finally {
            setIsOpening(false);
        }
    };

    return (
        <ActionButton
            icon={isOpening ? "bx bx-loader-alt bx-spin" : "bx bx-window-open"}
            text={t("book_properties.open_all_in_tabs_tooltip")}
            onClick={handleOpenAll}
            disabled={count === 0 || isOpening}
        />
    );
}

/**
 * The details of the results being opened, for `searchTermsFor()` to read their matched terms.
 * Empty if the request fails, so the tabs still open and fall back to the query's tokens.
 */
async function getResultDetails(searchNote: FNote, noteIds: string[]) {
    try {
        const { results } = await server.post<SearchResultDetailsResponse>(
            `search-note/${searchNote.noteId}/result-details`, { noteIds }
        );
        return new Map(results.map((details) => [ details.noteId, details ]));
    } catch (e) {
        logError(`Could not load the matched terms of search note '${searchNote.noteId}': ${getErrorMessage(e)}`);
        return new Map<string, SearchResultDetails>();
    }
}

export function useViewType(note: FNote | null | undefined) {
    const [ viewType, setViewType ] = useNoteLabel(note, "viewType");
    const defaultViewType = (note?.type === "search" ? "list" : "grid");
    const viewTypeWithDefault = (viewType ?? defaultViewType) as ViewTypeOptions;
    return [ viewTypeWithDefault, setViewType ] as const;
}

function ViewTypeSwitcher({ viewType, setViewType }: { viewType: ViewTypeOptions, setViewType: (newValue: ViewTypeOptions) => void }) {
    // Keyboard shortcut
    const dropdownContainerRef = useRef<HTMLDivElement>(null);
    const { ntxId: ownNtxId } = useNoteContext();
    useTriliumEvent("toggleRibbonTabBookProperties", ({ ntxId }) => {
        if (!ownNtxId || ntxId !== ownNtxId) return;
        dropdownContainerRef.current?.querySelector("button")?.focus();
    });

    return (
        <Dropdown
            dropdownContainerRef={dropdownContainerRef}
            text={<>
                <Icon icon={ICON_MAPPINGS[viewType]} />&nbsp;
                {VIEW_TYPE_MAPPINGS[viewType]}
            </>}
        >
            {Object.entries(VIEW_TYPE_MAPPINGS).map(([ key, label ]) => (
                <FormListItem
                    key={key}
                    onClick={() => setViewType(key as ViewTypeOptions)}
                    selected={viewType === key}
                    disabled={viewType === key}
                    icon={ICON_MAPPINGS[key as ViewTypeOptions]}
                    badges={key === "dashboard" ? [{ text: t("note_types.beta-feature") }] : undefined}
                >{label}</FormListItem>
            ))}
        </Dropdown>
    );
}

function ViewOptions({ note, viewType, optionsChildren }: {
    note: FNote,
    viewType: ViewTypeOptions,
    optionsChildren?: ComponentChildren
}) {
    const properties = bookPropertiesConfig[viewType].properties;

    return (
        <Dropdown
            buttonClassName="bx bx-cog icon-action"
            hideToggleArrow
            mobileBottomSheet
        >
            {properties.map((property, index) => (
                <ViewProperty key={index} note={note} property={property} />
            ))}
            {properties.length > 0 && <FormDropdownDivider />}

            <ViewProperty note={note} property={{
                type: "checkbox",
                icon: "bx bx-hide",
                label: t("book_properties.hide_child_notes"),
                bindToLabel: "subtreeHidden"
            } as CheckBoxProperty} />

            <ViewProperty note={note} property={{
                type: "checkbox",
                icon: "bx bx-archive",
                label: t("book_properties.include_archived_notes"),
                bindToLabel: "includeArchived"
            } as CheckBoxProperty} />

            {optionsChildren && <>
                <FormDropdownDivider />
                {optionsChildren}
            </>}
        </Dropdown>
    );
}
