import type { InputHTMLAttributes, RefObject } from "preact/compat";

interface FormTextBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
    id?: string;
    currentValue?: string;
    onChange?(newValue: string): void;
    inputRef?: RefObject<HTMLInputElement>;
}

export default function FormTextBox({ inputRef, className, type, currentValue, onChange, ...rest}: FormTextBoxProps) {
    if (type === "number" && currentValue) {
        const { min, max } = rest;
        console.log(currentValue , min, max);
        const currentValueNum = parseInt(currentValue, 10);
        if (min && currentValueNum < parseInt(String(min), 10)) {
            currentValue = String(min);
        } else if (max && currentValueNum > parseInt(String(max), 10)) {
            currentValue = String(max);
        }
    }

    return (
        <input
            ref={inputRef}
            className={`form-control ${className ?? ""}`}
            type={type ?? "text"}
            value={currentValue}
            onInput={e => onChange?.(e.currentTarget.value)}
            {...rest}
        />
    );
}

export function FormTextBoxWithUnit(props: FormTextBoxProps & { unit: string }) {
    return (
        <label class="input-group tn-number-unit-pair">
            <FormTextBox {...props} />
            <span class="input-group-text">{props.unit}</span>
        </label>        
    )
}