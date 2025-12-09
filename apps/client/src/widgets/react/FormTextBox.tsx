import { useEffect, type InputHTMLAttributes, type RefObject } from "preact/compat";

interface FormTextBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "onBlur" | "value"> {
    id?: string;
    currentValue?: string;
    onChange?(newValue: string, validity: ValidityState): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLInputElement>;
}

export default function FormTextBox({ inputRef, className, type, currentValue, onChange, onBlur, autoFocus, ...rest}: FormTextBoxProps) {
    useEffect(() => {
        if (autoFocus) {
            inputRef?.current?.focus();
        }
    }, []);

    function applyLimits(value: string) {
        if (type === "number") {
            const { min, max } = rest;
            const currentValueNum = parseInt(value, 10);
            if (min && currentValueNum < parseInt(String(min), 10)) {
                return String(min);
            } else if (max && currentValueNum > parseInt(String(max), 10)) {
                return String(max);
            }
        }

        return value;
    }

    return (
        <input
            ref={inputRef}
            className={`form-control ${className ?? ""}`}
            type={type ?? "text"}
            value={currentValue}
            onInput={onChange && (e => {
                const target = e.currentTarget;
                const currentValue = applyLimits(e.currentTarget.value);
                onChange?.(currentValue, target.validity);
            })}
            onBlur={(e => {
                const currentValue = applyLimits(e.currentTarget.value);
                e.currentTarget.value = currentValue;
                onBlur?.(currentValue);
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
