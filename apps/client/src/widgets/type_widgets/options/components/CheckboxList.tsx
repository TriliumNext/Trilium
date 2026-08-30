import "./CheckboxList.css";

interface CheckboxListProps<T> {
    values: T[];
    keyProperty: keyof T;
    titleProperty?: keyof T;
    disabledProperty?: keyof T;
    /**
     * Marks an entry as ticked whatever the stored set holds, for one the app applies regardless of
     * what was chosen. Pair it with {@link CheckboxListProps.disabledProperty}: a box that cannot be
     * cleared but reads as empty says the opposite of what happens.
     */
    alwaysOnProperty?: keyof T;
    currentValue: string[];
    onChange: (newValues: string[]) => void;
    columnWidth?: string;
}

export default function CheckboxList<T>({ values, keyProperty, titleProperty, disabledProperty, alwaysOnProperty, currentValue, onChange, columnWidth }: CheckboxListProps<T>) {
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
        <ul
            className="tn-checkbox-list"
            // Handed over as a property rather than set outright, so that CSS can still reach it.
            style={columnWidth ? { "--checkbox-list-column-width": columnWidth } : undefined}
        >
            {values.map(value => (
                <li>
                    <label className="tn-checkbox">
                        <input
                            type="checkbox"
                            className="form-check-input"
                            value={String(value[keyProperty])}
                            checked={currentValue.includes(String(value[keyProperty]))
                                || !!(alwaysOnProperty && value[alwaysOnProperty])}
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