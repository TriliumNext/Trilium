import FormTextBox, { type FormTextBoxProps } from "./FormTextBox";

/**
 * A date-time input rendering a native `<input type="datetime-local">`, so the browser's built-in
 * date/time picker is used. (HTML has no bare `type="datetime"`; `datetime-local` is the type browsers
 * render a native picker for.)
 *
 * Thin wrapper around {@link FormTextBox} that locks in `type="datetime-local"` — it inherits the same
 * controlled input handling, `onChange(newValue, validity)` / `onBlur` callbacks and `inputRef`.
 */
export default function FormDatetime(props: Omit<FormTextBoxProps, "type">) {
    return <FormTextBox type="datetime-local" placeholder="not set" {...props} />;
}
