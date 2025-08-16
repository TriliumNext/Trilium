import type { ComponentChildren } from "preact";
import { useUniqueName } from "./hooks";

interface FormRadioProps {
    name: string;
    currentValue?: string;
    values: {
        value: string;
        label: string | ComponentChildren;
    }[];
    onChange(newValue: string): void;
}

export default function FormRadioGroup({ values, ...restProps }: FormRadioProps) {
    return (
        <>
            {(values || []).map(({ value, label }) => (
                <div className="form-checkbox">
                    <FormRadio value={value} label={label} {...restProps} labelClassName="form-check-label" />
                </div>
            ))}
        </>
    );
}

export function FormInlineRadioGroup({ values, ...restProps }: FormRadioProps) {
    return (
        <>
            {values.map(({ value, label }) => (<FormRadio value={value} label={label} {...restProps} />))}
        </>
    )
}

function FormRadio({ name, value, label, currentValue, onChange, labelClassName }: Omit<FormRadioProps, "values"> & { value: string, label: ComponentChildren, labelClassName?: string }) {
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
            {label}
        </label>
    )
}