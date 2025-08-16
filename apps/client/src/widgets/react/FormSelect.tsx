import type { ComponentChildren } from "preact";

type OnChangeListener = (newValue: string) => void;

interface FormSelectGroup<T> {
    title: string;
    items: T[];
}

interface ValueConfig<T, Q> {
    values: Q[];
    /** The property of an item of {@link values} to be used as the key, uniquely identifying it. The key will be passed to the change listener. */
    keyProperty: keyof T;
    /** The property of an item of {@link values} to be used as the label, representing a human-readable version of the key. If missing, {@link keyProperty} will be used instead. */
    titleProperty?: keyof T; 
    /** The current value of the combobox. The value will be looked up by going through {@link values} and looking an item whose {@link #keyProperty} value matches this one */
    currentValue?: string;
}

interface FormSelectProps<T, Q> extends ValueConfig<T, Q> {
    onChange: OnChangeListener;
}

/**
 * Combobox component that takes in any object array as data. Each item of the array is rendered as an item, and the key and values are obtained by looking into the object by a specified key.
 */
export default function FormSelect<T>(props: FormSelectProps<T, T>) {
    return (
        <FormSelectBody onChange={props.onChange}>
            <FormSelectGroup {...props} />
        </FormSelectBody>
    );
}

/**
 * Similar to {@link FormSelect}, but the top-level elements are actually groups.
 */
export function FormSelectWithGroups<T>({ values, keyProperty, titleProperty, currentValue, onChange }: FormSelectProps<T, FormSelectGroup<T>>) {
    return (
        <FormSelectBody onChange={onChange}>
            {values.map(({ title, items }) => {
                return (
                    <optgroup label={title}>
                        <FormSelectGroup values={items} keyProperty={keyProperty} titleProperty={titleProperty} currentValue={currentValue} />
                    </optgroup>
                );
            })}
        </FormSelectBody>
    )
}

function FormSelectBody({ children, onChange }: { children: ComponentChildren, onChange: OnChangeListener }) {
    return (
        <select
            class="form-select"
            onChange={e => onChange((e.target as HTMLInputElement).value)}
        >
            {children}
        </select>
    )
}

function FormSelectGroup<T>({ values, keyProperty, titleProperty, currentValue }: ValueConfig<T, T>) {
    return values.map(item => {
        return (
            <option
                value={item[keyProperty] as any}
                selected={item[keyProperty] === currentValue}
            >
                {item[titleProperty ?? keyProperty] ?? item[keyProperty] as any}
            </option>
        );
    });
}