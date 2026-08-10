import { Fragment } from "preact";

import Dropdown, { DropdownProps } from "./Dropdown";
import { FormDropdownDivider, FormListItem } from "./FormList";
import Icon from "./Icon";

interface FormDropdownList<T> extends Omit<DropdownProps, "children"> {
    values: T[];
    keyProperty: keyof T;
    titleProperty: keyof T;
    /** Property to show as a small suffix next to the title */
    titleSuffixProperty?: keyof T;
    descriptionProperty?: keyof T;
    /** Property holding the icon of an item, e.g. `bx bx-calendar`. Shown on the items and on the button. */
    iconProperty?: keyof T;
    /**
     * Property marking an item as starting a group of its own, drawing a divider above it. For a list
     * whose entries are not all the same sort of choice, e.g. one that changes more than the others do.
     */
    dividerBeforeProperty?: keyof T;
    currentValue: string;
    onChange(newValue: string): void;
}

export default function FormDropdownList<T>({ values, keyProperty, titleProperty, titleSuffixProperty, descriptionProperty, iconProperty, dividerBeforeProperty, currentValue, onChange, ...restProps }: FormDropdownList<T>) {
    const currentValueData = values.find(value => value[keyProperty] === currentValue);

    const renderTitle = (item: T) => {
        const title = item[titleProperty] as string;
        const suffix = titleSuffixProperty ? item[titleSuffixProperty] as string : null;
        if (suffix) {
            return <>{title} <small>{suffix}</small></>;
        }
        return title;
    };

    const renderLabel = (item: T) => (
        iconProperty
            ? <><Icon icon={item[iconProperty] as string} />&nbsp;{renderTitle(item)}</>
            : renderTitle(item)
    );

    return (
        <Dropdown text={currentValueData ? renderLabel(currentValueData) : ""} {...restProps}>
            {values.map(item => {
                const isCurrent = currentValue === item[keyProperty];
                return (
                    <Fragment key={item[keyProperty] as string}>
                        {dividerBeforeProperty && !!item[dividerBeforeProperty] && <FormDropdownDivider />}

                        <FormListItem
                            icon={iconProperty ? item[iconProperty] as string : undefined}
                            onClick={() => onChange(item[keyProperty] as string)}
                            // The check mark takes the place of the item's icon, so where the items carry
                            // one the current value is marked by highlighting the item instead of by a mark.
                            checked={!iconProperty && isCurrent}
                            active={!!iconProperty && isCurrent}
                            description={descriptionProperty && item[descriptionProperty] as string}
                            selected={isCurrent}
                        >
                            {renderTitle(item)}
                        </FormListItem>
                    </Fragment>
                );
            })}
        </Dropdown>
    );
}
