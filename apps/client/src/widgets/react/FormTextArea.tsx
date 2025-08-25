import { RefObject, TextareaHTMLAttributes } from "preact/compat";

interface FormTextAreaProps extends Omit<TextareaHTMLAttributes, "onBlur" | "onChange"> {
    id?: string;
    currentValue: string;
    onChange?(newValue: string): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLTextAreaElement>
}
export default function FormTextArea({ inputRef, id, onBlur, onChange, currentValue, className, ...restProps }: FormTextAreaProps) {
    return (
        <textarea
            ref={inputRef}
            id={id}
            className={`form-control ${className ?? ""}`}
            onChange={(e) => {
                onChange?.(e.currentTarget.value);
            }}
            onBlur={(e) => {
                onBlur?.(e.currentTarget.value);
            }}
            style={{ width: "100%" }}
            {...restProps}
        >{currentValue}</textarea>
    )
}
