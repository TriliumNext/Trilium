import { Ref } from "preact";
import Button, { ButtonProps } from "./Button";
import { useRef } from "preact/hooks";

interface FormFileUploadProps {
    name?: string;
    onChange: (files: FileList | null) => void;
    multiple?: boolean;
    hidden?: boolean;
    inputRef?: Ref<HTMLInputElement>;
}

export default function FormFileUpload({ inputRef, name, onChange, multiple, hidden }: FormFileUploadProps) {
    return (
        <label class="tn-file-input tn-input-field" style={hidden ? { display: "none" } : undefined}>
            <input
                ref={inputRef}
                name={name}
                type="file"
                class="form-control-file"
                multiple={multiple}                
                onChange={e => onChange((e.target as HTMLInputElement).files)} />
        </label>
    )
}

/**
 * Combination of a button with a hidden file upload field.
 * 
 * @param param the change listener for the file upload and the properties for the button.
 */
export function FormFileUploadButton({ onChange, ...buttonProps }: Omit<ButtonProps, "onClick"> & Pick<FormFileUploadProps, "onChange">) {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <Button
                {...buttonProps}
                onClick={() => inputRef.current?.click()}
            />
            <FormFileUpload
                inputRef={inputRef} 
                hidden
                onChange={onChange}
            />
        </>
    )
}