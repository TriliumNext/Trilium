import FormTextBox, { type FormTextBoxProps } from "./FormTextBox";

/**
 * A numeric input rendering a native `<input type="number">`, so the browser's number spinner is used.
 *
 * Thin wrapper around {@link FormTextBox} that locks in `type="number"` — it inherits the same controlled
 * input handling, `min`/`max` clamping, `onChange(newValue, validity)` / `onBlur` callbacks and `inputRef`.
 * `min`, `max` and `step` are forwarded as native attributes. The value is a string, consistent with the
 * other numeric inputs in the codebase (consumers parse it if a `number` is needed).
 */
export default function FormNumber(props: Omit<FormTextBoxProps, "type">) {
    return <FormTextBox type="number" {...props} />;
}
