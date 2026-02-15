import { FilterLabelsByType } from "@triliumnext/commons";
import { Fragment, VNode } from "preact";
import { useContext } from "preact/hooks";

import Component from "../../components/component";
import FNote from "../../entities/fnote";
import NoteContextAwareWidget from "../note_context_aware_widget";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem, FormListToggleableItem } from "./FormList";
import FormTextBox from "./FormTextBox";
import { useNoteLabel, useNoteLabelBoolean, useNoteLabelWithDefault } from "./hooks";
import { ParentComponent } from "./react_utils";

export interface ClickContext {
    note: FNote;
    triggerCommand: NoteContextAwareWidget["triggerCommand"];
}

export interface CheckBoxProperty {
    type: "checkbox",
    label: string;
    bindToLabel: FilterLabelsByType<boolean>;
    icon?: string;
}

export interface ButtonProperty {
    type: "button",
    label: string;
    title?: string;
    icon?: string;
    onClick(context: ClickContext): void;
}

export interface SplitButtonProperty extends Omit<ButtonProperty, "type"> {
    type: "split-button";
    items({ note, parentComponent }: { note: FNote, parentComponent: Component }): VNode;
}

export interface NumberProperty {
    type: "number",
    label: string;
    bindToLabel: FilterLabelsByType<number>;
    width?: number;
    min?: number;
    icon?: string;
    disabled?: (note: FNote) => boolean;
}

export interface ComboBoxItem {
    /**
     * The value to set to the bound label, `null` has a special meaning which removes the label entirely.
     */
    value: string | null;
    label: string;
}

export interface ComboBoxGroup {
    title: string;
    items: ComboBoxItem[];
}

interface Separator {
    type: "separator"
}

export interface ComboBoxProperty {
    type: "combobox",
    label: string;
    icon?: string;
    bindToLabel: FilterLabelsByType<string>;
    /**
     * The default value is used when the label is not set.
     */
    defaultValue?: string;
    options: (ComboBoxItem | Separator | ComboBoxGroup)[];
    dropStart?: boolean;
}

export type BookProperty = CheckBoxProperty | ButtonProperty | NumberProperty | ComboBoxProperty | SplitButtonProperty | Separator;

export function ViewProperty({ note, property }: { note: FNote, property: BookProperty }) {
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
        case "separator":
            return <FormDropdownDivider />;
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
    const [ value, setValue ] = useNoteLabel(note, property.bindToLabel);
    const valueWithDefault = value ?? property.defaultValue ?? null;

    function renderItem(option: ComboBoxItem) {
        return (
            <FormListItem
                key={option.value}
                checked={valueWithDefault === option.value}
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
            dropStart={property.dropStart}
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
                if ("type" in option) {
                    return <FormDropdownDivider key={index} />;
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
