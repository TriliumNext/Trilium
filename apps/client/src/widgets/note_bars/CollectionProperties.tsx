import "./CollectionProperties.css";

import { t } from "i18next";
import { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";

import FNote from "../../entities/fnote";
import { ViewTypeOptions } from "../collections/interface";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useNoteProperty, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { CheckBoxProperty, ViewProperty } from "../react/NotePropertyMenu";
import { bookPropertiesConfig } from "../ribbon/collection-properties-config";
import { useViewType, VIEW_TYPE_MAPPINGS } from "../ribbon/CollectionPropertiesTab";

export const ICON_MAPPINGS: Record<ViewTypeOptions, string> = {
    grid: "bx bxs-grid",
    list: "bx bx-list-ul",
    calendar: "bx bx-calendar",
    table: "bx bx-table",
    geoMap: "bx bx-map-alt",
    board: "bx bx-columns",
    presentation: "bx bx-rectangle"
};

export default function CollectionProperties({ note, centerChildren, rightChildren }: {
    note: FNote;
    centerChildren?: ComponentChildren;
    rightChildren?: ComponentChildren;
}) {
    const [ viewType, setViewType ] = useViewType(note);
    const noteType = useNoteProperty(note, "type");

    return ([ "book", "search" ].includes(noteType ?? "") &&
        <div className="collection-properties">
            <div className="left-container">
                <ViewTypeSwitcher viewType={viewType} setViewType={setViewType} />
                <ViewOptions note={note} viewType={viewType} />
            </div>
            <div className="center-container">
                {centerChildren}
            </div>
            <div className="right-container">
                {rightChildren}
            </div>
        </div>
    );
}

function ViewTypeSwitcher({ viewType, setViewType }: { viewType: ViewTypeOptions, setViewType: (newValue: ViewTypeOptions) => void }) {
    // Keyboard shortcut
    const dropdownContainerRef = useRef<HTMLDivElement>(null);
    useTriliumEvent("toggleRibbonTabBookProperties", () => {
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
                >{label}</FormListItem>
            ))}
        </Dropdown>
    );
}

function ViewOptions({ note, viewType }: { note: FNote, viewType: ViewTypeOptions }) {
    const properties = bookPropertiesConfig[viewType].properties;

    return (
        <Dropdown
            buttonClassName="bx bx-cog icon-action"
            hideToggleArrow
            dropdownContainerClassName="mobile-bottom-menu"
            mobileBackdrop
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
        </Dropdown>
    );
}
