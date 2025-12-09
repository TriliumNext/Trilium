import type { ComponentChildren } from "preact";
import { CSSProperties } from "preact/compat";

type OnChangeListener = (newValue: string) => void;

export interface FormSelectGroup<T> {
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
    id?: string;
    name?: string;
    onChange: OnChangeListener;
    style?: CSSProperties;
    className?: string;
}

/**
 * Combobox component that takes in any object array as data. Each item of the array is rendered as an item, and the key and values are obtained by looking into the object by a specified key.
 */
export default function FormSelect<T>({ name, id, onChange, style, className, ...restProps }: FormSelectProps<T, T>) {
    return (
        <FormSelectBody name={name} id={id} onChange={onChange} style={style} className={className}>
            <FormSelectGroup {...restProps} />
        </FormSelectBody>
    );
}

/**
 * Similar to {@link FormSelect}, but the top-level elements are actually groups.
 */
export function FormSelectWithGroups<T>({ name, id, values, keyProperty, titleProperty, currentValue, onChange, ...restProps }: FormSelectProps<T, FormSelectGroup<T> | T>) {
    return (
        <FormSelectBody name={name} id={id} onChange={onChange} {...restProps}>
            {values.map((item) => {
                if (!item) return <></>;
                if (typeof item === "object" && "items" in item) {
                    return (
                        <optgroup label={item.title}>
                            <FormSelectGroup values={item.items} keyProperty={keyProperty} titleProperty={titleProperty} currentValue={currentValue} />
                        </optgroup>
                    );
                } else {
                    return (
                        <FormSelectGroup values={[ item ]} keyProperty={keyProperty} titleProperty={titleProperty} currentValue={currentValue} />
                    )
                }
            })}
        </FormSelectBody>
    )
}

function FormSelectBody({ id, name, children, onChange, style, className }: { id?: string, name?: string, children: ComponentChildren, onChange: OnChangeListener, style?: CSSProperties, className?: string }) {
    return (
        <select
            id={id}
            name={name}
            onChange={e => onChange((e.target as HTMLInputElement).value)}
            style={style}
            className={`form-select ${className ?? ""}`}
        >
            {children}
        </select>
    )
}

function FormSelectGroup<T>({ values, keyProperty, titleProperty, currentValue }: ValueConfig<T, T>) {
    return values.map(item => {
        return (
            <option
                value={item[keyProperty] as string | number}
                selected={item[keyProperty] === currentValue}
            >
                {item[titleProperty ?? keyProperty] ?? item[keyProperty] as string | number}
            </option>
        );
    });
}