import { useEffect, useRef, type InputHTMLAttributes, type RefObject } from "preact/compat";

export interface FormTextBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "onBlur" | "value"> {
    id?: string;
    currentValue?: string;
    onChange?(newValue: string, validity: ValidityState): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLInputElement>;
}

export default function FormTextBox({ inputRef, className, type, currentValue, onChange, onBlur, autoFocus, ...rest}: FormTextBoxProps) {
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (autoFocus) {
            innerRef.current?.focus();
        }
    }, []);

    function applyLimits(value: string) {
        if (type === "number") {
            const { min, max } = rest;
            const currentValueNum = parseInt(value, 10);
            if (!Number.isFinite(currentValueNum)) {
                return String(min ?? "");
            }
            if (min && currentValueNum < parseInt(String(min), 10)) {
                return String(min);
            } else if (max && currentValueNum > parseInt(String(max), 10)) {
                return String(max);
            }
        }

        return value;
    }

    // A number box's spinner steps the value without the focus ever arriving, so a commit waiting
    // on the blur may never come; the native change event is what a step fires — once per step, and
    // once alongside the blur for a value typed in — so the commit rides on it instead. Bound by
    // hand because there is no JSX way to it: preact/compat, loaded module-graph-wide by any
    // compat-using import, remaps `onChange` — in any casing — to the input event. Held in a ref so
    // the once-bound listener commits through the props of the render it fires in, not the one it
    // was bound in.
    const commitNumber = useRef<() => void>();
    commitNumber.current = () => {
        const input = innerRef.current;
        if (!input) return;

        const value = applyLimits(input.value);
        input.value = value;
        onBlur?.(value);
    };

    useEffect(() => {
        const input = innerRef.current;
        if (type !== "number" || !input) return;

        const onNativeChange = () => commitNumber.current?.();
        input.addEventListener("change", onNativeChange);
        return () => input.removeEventListener("change", onNativeChange);
    }, [ type ]);

    return (
        <input
            ref={(element) => {
                innerRef.current = element;
                if (inputRef) inputRef.current = element;
            }}
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
                // A number box commits through the change listener above, which the blur already
                // fired where anything changed; committing here too would only say it twice.
                if (type !== "number") onBlur?.(currentValue);
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
