import "./CollectionProperties.css";

import { t } from "i18next";
import { useContext, useRef } from "preact/hooks";
import { Fragment } from "preact/jsx-runtime";

import FNote from "../../entities/fnote";
import { getHelpUrlForNote } from "../../services/in_app_help";
import { openInAppHelpFromUrl } from "../../services/utils";
import { ViewTypeOptions } from "../collections/interface";
import ActionButton from "../react/ActionButton";
import Dropdown from "../react/Dropdown";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem, FormListToggleableItem } from "../react/FormList";
import FormTextBox from "../react/FormTextBox";
import { useNoteLabel, useNoteLabelBoolean, useNoteLabelWithDefault, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import { ParentComponent } from "../react/react_utils";
import { bookPropertiesConfig, BookProperty, ButtonProperty, CheckBoxProperty, ComboBoxItem, ComboBoxProperty, NumberProperty, SplitButtonProperty } from "../ribbon/collection-properties-config";
import { useViewType, VIEW_TYPE_MAPPINGS } from "../ribbon/CollectionPropertiesTab";

const ICON_MAPPINGS: Record<ViewTypeOptions, string> = {
    grid: "bx bxs-grid",
    list: "bx bx-list-ul",
    calendar: "bx bx-calendar",
    table: "bx bx-table",
    geoMap: "bx bx-map-alt",
    board: "bx bx-columns",
    presentation: "bx bx-rectangle"
};

export default function CollectionProperties({ note }: { note: FNote }) {
    const [ viewType, setViewType ] = useViewType(note);

    return (
        <div className="collection-properties">
            <ViewTypeSwitcher viewType={viewType} setViewType={setViewType} />
            <ViewOptions note={note} viewType={viewType} />
            <div className="spacer" />
            <HelpButton note={note} />
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
        >
            {properties.map(property => (
                <ViewProperty key={property.label} note={note} property={property} />
            ))}
            {properties.length > 0 && <FormDropdownDivider />}

            <ViewProperty note={note} property={{
                type: "checkbox",
                icon: "bx bx-archive",
                label: t("book_properties.include_archived_notes"),
                bindToLabel: "includeArchived"
            } as CheckBoxProperty} />
        </Dropdown>
    );
}

function ViewProperty({ note, property }: { note: FNote, property: BookProperty }) {
    switch (property.type) {
        case "button":
            return <ButtonPropertyView note={note} property={property} />;
        case "split-button":
            return <SplitButtonPropertyView note={note} property={property} />;
        case "checkbox":
            return <CheckBoxPropertyView note={note} property={property} />;
        case "number":
            return <NumberPropertyView note={note} property={property} />;
        case "combobox":
            return <ComboBoxPropertyView note={note} property={property} />;
    }
}

function ButtonPropertyView({ note, property }: { note: FNote, property: ButtonProperty }) {
    const parentComponent = useContext(ParentComponent);

    return (
        <FormListItem
            icon={property.icon}
            title={property.title}
            onClick={() => {
                if (!parentComponent) return;
                property.onClick({
                    note,
                    triggerCommand: parentComponent.triggerCommand.bind(parentComponent)
                });
            }}
        >{property.label}</FormListItem>
    );
}

function SplitButtonPropertyView({ note, property }: { note: FNote, property: SplitButtonProperty }) {
    const parentComponent = useContext(ParentComponent);
    const ItemsComponent = property.items;
    const clickContext = parentComponent && {
        note,
        triggerCommand: parentComponent.triggerCommand.bind(parentComponent)
    };

    return (parentComponent &&
        <FormDropdownSubmenu
            icon={property.icon ?? "bx bx-empty"}
            title={property.label}
            onDropdownToggleClicked={() => clickContext && property.onClick(clickContext)}
        >
            <ItemsComponent note={note} parentComponent={parentComponent} />
        </FormDropdownSubmenu>
    );
}

function NumberPropertyView({ note, property }: { note: FNote, property: NumberProperty }) {
    //@ts-expect-error Interop with text box which takes in string values even for numbers.
    const [ value, setValue ] = useNoteLabel(note, property.bindToLabel);
    const disabled = property.disabled?.(note);

    return (
        <FormListItem
            icon={property.icon}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
        >
            {property.label}
            <FormTextBox
                type="number"
                currentValue={value ?? ""} onChange={setValue}
                style={{ width: (property.width ?? 100) }}
                min={property.min ?? 0}
                disabled={disabled}
            />
        </FormListItem>
    );
}

function ComboBoxPropertyView({ note, property }: { note: FNote, property: ComboBoxProperty }) {
    const [ value, setValue ] = useNoteLabelWithDefault(note, property.bindToLabel, property.defaultValue ?? "");

    function renderItem(option: ComboBoxItem) {
        return (
            <FormListItem
                key={option.value}
                checked={value === option.value}
                onClick={() => setValue(option.value)}
            >
                {option.label}
            </FormListItem>
        );
    }

    return (
        <FormDropdownSubmenu
            title={property.label}
            icon={property.icon ?? "bx bx-empty"}
        >
            {(property.options).map((option, index) => {
                if ("items" in option) {
                    return (
                        <Fragment key={option.title}>
                            <FormListItem key={option.title} disabled>{option.title}</FormListItem>
                            {option.items.map(renderItem)}
                            {index < property.options.length - 1 && <FormDropdownDivider />}
                        </Fragment>
                    );
                }
                return renderItem(option);

            })}
        </FormDropdownSubmenu>
    );
}

function CheckBoxPropertyView({ note, property }: { note: FNote, property: CheckBoxProperty }) {
    const [ value, setValue ] = useNoteLabelBoolean(note, property.bindToLabel);
    return (
        <FormListToggleableItem
            icon={property.icon}
            title={property.label}
            currentValue={value}
            onChange={setValue}
        />
    );
}

function HelpButton({ note }: { note: FNote }) {
    const helpUrl = getHelpUrlForNote(note);

    return (helpUrl && (
        <ActionButton
            icon="bx bx-help-circle"
            onClick={(() => openInAppHelpFromUrl(helpUrl))}
            text={t("help-button.title")}
        />
    ));
}
