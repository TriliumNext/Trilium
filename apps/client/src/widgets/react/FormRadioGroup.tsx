import type { ComponentChildren } from "preact";
import { useUniqueName } from "./hooks";

interface FormRadioProps {
    name: string;
    currentValue?: string;
    values: {
        value: string;
        label: string | ComponentChildren;
        inlineDescription?: string | ComponentChildren;
    }[];
    onChange(newValue: string): void;
}

export default function FormRadioGroup({ values, ...restProps }: FormRadioProps) {
    return (
        <div role="group">
            {(values || []).map(({ value, label, inlineDescription }) => (
                <div className="form-checkbox">
                    <FormRadio
                        value={value}
                        label={label} inlineDescription={inlineDescription}
                        labelClassName="form-check-label"
                        {...restProps}
                    />
                </div>
            ))}
        </div>
    );
}

export function FormInlineRadioGroup({ values, ...restProps }: FormRadioProps) {
    return (
        <div role="group">
            {values.map(({ value, label }) => (<FormRadio value={value} label={label} {...restProps} />))}
        </div>
    )
}

function FormRadio({ name, value, label, currentValue, onChange, labelClassName, inlineDescription }: Omit<FormRadioProps, "values"> & { value: string, label: ComponentChildren, inlineDescription?: ComponentChildren, labelClassName?: string }) {
    return (
        <label className={`tn-radio ${labelClassName ?? ""}`}>
            <input
                className="form-check-input"
                type="radio"
                name={useUniqueName(name)}
                value={value}
                checked={value === currentValue}
                onChange={e => onChange((e.target as HTMLInputElement).value)}
            />
            {inlineDescription ?
                <><strong>{label}</strong> - {inlineDescription}</>
            : label}
        </label>
    )
}