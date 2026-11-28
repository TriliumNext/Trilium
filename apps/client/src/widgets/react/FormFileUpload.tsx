import { Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";

import ActionButton, { ActionButtonProps } from "./ActionButton";
import Button, { ButtonProps } from "./Button";
import { FormListItem, FormListItemOpts } from "./FormList";

export interface FormFileUploadProps {
    name?: string;
    onChange: (files: FileList | null) => void;
    multiple?: boolean;
    hidden?: boolean;
    inputRef?: Ref<HTMLInputElement>;
    /** The types of file the chooser offers, as the `accept` attribute of the input names them. */
    accept?: string;
    /**
     * Clears the choice once `onChange` has run, so that choosing the same file again is a change
     * too. `onChange` must then read the files before it returns.
     */
    clearAfterChange?: boolean;
}

export default function FormFileUpload({ inputRef, name, onChange, multiple, hidden, accept, clearAfterChange }: FormFileUploadProps) {
    // Prevent accidental reuse of a file selected in a previous instance of the upload form.
    useEffect(() => {
        onChange(null);
    }, []);

    return (
        <label class="tn-file-input tn-input-field" style={hidden ? { display: "none" } : undefined}>
            <input
                ref={inputRef}
                name={name}
                type="file"
                class="form-control-file"
                multiple={multiple}
                accept={accept}
                onChange={(e) => {
                    const input = e.currentTarget;
                    onChange(input.files);
                    if (clearAfterChange) input.value = "";
                }} />
        </label>
    );
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
    );
}

/**
 * Similar to {@link FormFileUploadButton}, but uses an {@link ActionButton} instead of a normal {@link Button}.
 * @param param the change listener for the file upload and the properties for the button.
 */
export function FormFileUploadActionButton({ onChange, ...buttonProps }: Omit<ActionButtonProps, "onClick"> & Pick<FormFileUploadProps, "onChange">) {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <ActionButton
                {...buttonProps}
                onClick={() => inputRef.current?.click()}
            />
            <FormFileUpload
                inputRef={inputRef}
                hidden
                onChange={onChange}
            />
        </>
    );
}

/**
 * Similar to {@link FormFileUploadButton}, but uses an {@link FormListItem} instead of a normal {@link Button}.
 * @param param the change listener for the file upload and the properties for the button.
 */
export function FormFileUploadFormListItem({ onChange, children, ...buttonProps }: Omit<FormListItemOpts, "onClick"> & Pick<FormFileUploadProps, "onChange">) {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <FormListItem
                {...buttonProps}
                onClick={() => inputRef.current?.click()}
            >{children}</FormListItem>
            <FormFileUpload
                inputRef={inputRef}
                hidden
                onChange={onChange}
            />
        </>
    );
}
