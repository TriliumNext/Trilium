import FormCheckbox from "../../../react/FormCheckbox";

interface CheckboxListProps<T> {
    values: T[];
    keyProperty: keyof T;
    titleProperty?: keyof T;
    disabledProperty?: keyof T;
    descriptionProperty?: keyof T;
    currentValue: string[];
    onChange: (newValues: string[]) => void;
    columnWidth?: string;
}

export default function CheckboxList<T>({ values, keyProperty, titleProperty, disabledProperty, descriptionProperty, currentValue, onChange, columnWidth }: CheckboxListProps<T>) {
    function toggleValue(value: string) {
        if (currentValue.includes(value)) {
            // Already there, needs removing.
            onChange(currentValue.filter(v => v !== value));
        } else {
            // Not there, needs adding.
            onChange([ ...currentValue, value ]);
        }
    }

    return (
        <ul style={{ listStyleType: "none", marginBottom: 0, columnWidth: columnWidth ?? "400px" }}>
            {values.map(value => (
                <li key={String(value[keyProperty])}>
                    <FormCheckbox
                        label={String(value[titleProperty ?? keyProperty] ?? value[keyProperty])}
                        name={String(value[keyProperty])}
                        currentValue={currentValue.includes(String(value[keyProperty]))}
                        disabled={!!(disabledProperty && value[disabledProperty])}
                        hint={value && (descriptionProperty ? String(value[descriptionProperty]) : undefined)}
                        onChange={() => toggleValue(String(value[keyProperty]))}
                    />
                </li>
            ))}
        </ul>
    );
}
