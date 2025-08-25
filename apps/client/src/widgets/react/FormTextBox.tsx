import { useEffect, type InputHTMLAttributes, type RefObject } from "preact/compat";

interface FormTextBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "onBlur" | "value"> {
    id?: string;
    currentValue?: string;
    onChange?(newValue: string, validity: ValidityState): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLInputElement>;
}

export default function FormTextBox({ inputRef, className, type, currentValue, onChange, onBlur, autoFocus, ...rest}: FormTextBoxProps) {
    if (type === "number" && currentValue) {
        const { min, max } = rest;
        const currentValueNum = parseInt(currentValue, 10);
        if (min && currentValueNum < parseInt(String(min), 10)) {
            currentValue = String(min);
        } else if (max && currentValueNum > parseInt(String(max), 10)) {
            currentValue = String(max);
        }
    }

    useEffect(() => {
        if (autoFocus) {
            inputRef?.current?.focus();
        }
    }, []);

    return (
        <input
            ref={inputRef}
            className={`form-control ${className ?? ""}`}
            type={type ?? "text"}
            value={currentValue}
            onInput={onChange && (e => {
                const target = e.currentTarget;
                onChange?.(target.value, target.validity);
            })}
            onBlur={onBlur && (e => {
                const target = e.currentTarget;
                onBlur(target.value);
            })}
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