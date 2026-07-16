import FormTextBox, { type FormTextBoxProps } from "./FormTextBox";

/**
 * A time input rendering a native `<input type="time">`, so the browser's built-in time picker is used.
 *
 * Thin wrapper around {@link FormTextBox} that locks in `type="time"` — it inherits the same controlled
 * input handling, `onChange(newValue, validity)` / `onBlur` callbacks and `inputRef`. The value is a
 * `"HH:mm"` string.
 */
export default function FormTime(props: Omit<FormTextBoxProps, "type">) {
    return <FormTextBox type="time" placeholder="not set" {...props} />;
}
