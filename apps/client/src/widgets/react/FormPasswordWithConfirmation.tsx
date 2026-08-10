import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import FormGroup from "./FormGroup";
import FormTextBox from "./FormTextBox";

export interface FormPasswordWithConfirmationProps {
    /** Label of the first field. Defaults to a plain "Password". */
    label?: string;
    /** Label of the second field. Defaults to a plain "Repeat password". */
    confirmationLabel?: string;
    /** Focus target, for a host that wants the first field focused when it opens. */
    inputRef?: RefObject<HTMLInputElement>;
    /**
     * Whether leaving both fields empty is an answer in itself, for a password that is offered
     * rather than required. It is reported as an empty string, which is a settled "no password" as
     * against the `null` of one that is half-typed.
     */
    optional?: boolean;
    /**
     * Receives the password once both fields agree and neither is empty, and `null` at every other
     * moment. A host enables its confirm action on a non-null value and needs no validation of its
     * own. See {@link optional} for the one case where empty is a value rather than a `null`.
     */
    onChange(password: string | null): void;
}

/**
 * A password and its confirmation, for choosing a password rather than entering a known one.
 *
 * The pair reports one value rather than two, so what a host has to reason about is "is there a
 * password yet", not which of the two fields is behind. The mismatch is stated on the second field,
 * where it is caused.
 */
export default function FormPasswordWithConfirmation({ label, confirmationLabel, inputRef, optional, onChange }: FormPasswordWithConfirmationProps) {
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");

    // Held in a ref so an inline callback does not re-run the effect on every render of the host.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        // Untouched and allowed to stay that way: an answer, rather than an unfinished one.
        if (optional && !password && !confirmation) {
            onChangeRef.current("");
            return;
        }

        onChangeRef.current(password.length > 0 && password === confirmation ? password : null);
    }, [password, confirmation, optional]);

    return (
        <>
            <FormGroup name="password" label={label ?? t("password_with_confirmation.password")}>
                <FormTextBox
                    inputRef={inputRef}
                    type="password"
                    autoComplete="new-password"
                    currentValue={password}
                    onChange={setPassword}
                />
            </FormGroup>

            <FormGroup
                name="password-confirmation"
                label={confirmationLabel ?? t("password_with_confirmation.repeat_password")}
                error={confirmation.length > 0 && password !== confirmation ? t("password_with_confirmation.mismatch") : undefined}
            >
                <FormTextBox
                    type="password"
                    autoComplete="new-password"
                    currentValue={confirmation}
                    onChange={setConfirmation}
                />
            </FormGroup>
        </>
    );
}
