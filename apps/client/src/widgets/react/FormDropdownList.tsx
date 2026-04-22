import Dropdown, { DropdownProps } from "./Dropdown";
import { FormListItem } from "./FormList";

interface FormDropdownList<T> extends Omit<DropdownProps, "children"> {
    values: T[];
    keyProperty: keyof T;
    titleProperty: keyof T;
    /** Property to show as a small suffix next to the title */
    titleSuffixProperty?: keyof T;
    descriptionProperty?: keyof T;
    currentValue: string;
    onChange(newValue: string): void;
}

export default function FormDropdownList<T>({ values, keyProperty, titleProperty, titleSuffixProperty, descriptionProperty, currentValue, onChange, ...restProps }: FormDropdownList<T>) {
    const currentValueData = values.find(value => value[keyProperty] === currentValue);

    const renderTitle = (item: T) => {
        const title = item[titleProperty] as string;
        const suffix = titleSuffixProperty ? item[titleSuffixProperty] as string : null;
        if (suffix) {
            return <>{title} <small>{suffix}</small></>;
        }
        return title;
    };

    return (
        <Dropdown text={currentValueData ? renderTitle(currentValueData) : ""} {...restProps}>
            {values.map(item => (
                <FormListItem
                    onClick={() => onChange(item[keyProperty] as string)}
                    checked={currentValue === item[keyProperty]}
                    description={descriptionProperty && item[descriptionProperty] as string}
                    selected={currentValue === item[keyProperty]}
                >
                    {renderTitle(item)}
                </FormListItem>
            ))}
        </Dropdown>
    )
}
