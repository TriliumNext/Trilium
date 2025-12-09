interface CheckboxListProps<T> {
    values: T[];
    keyProperty: keyof T;
    titleProperty?: keyof T;
    disabledProperty?: keyof T;
    currentValue: string[];
    onChange: (newValues: string[]) => void;
    columnWidth?: string;
}

export default function CheckboxList<T>({ values, keyProperty, titleProperty, disabledProperty, currentValue, onChange, columnWidth }: CheckboxListProps<T>) {    
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
                <li>
                    <label className="tn-checkbox">
                        <input
                            type="checkbox"
                            className="form-check-input"
                            value={String(value[keyProperty])}
                            checked={currentValue.includes(String(value[keyProperty]))}
                            disabled={!!(disabledProperty && value[disabledProperty])}
                            onChange={e => toggleValue((e.target as HTMLInputElement).value)}
                        />
                        {String(value[titleProperty ?? keyProperty] ?? value[keyProperty])}
                    </label>
                </li>
            ))}
        </ul>
    )
}