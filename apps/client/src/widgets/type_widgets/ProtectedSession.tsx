import "./ProtectedSession.css";

import type { TargetedSubmitEvent } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import protected_session from "../../services/protected_session";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup";
import FormTextBox from "../react/FormTextBox";

export default function ProtectedSession({ autoFocus = false }: { autoFocus?: boolean }) {
    const passwordRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) {
            passwordRef.current?.focus();
        }
    }, [ autoFocus ]);

    const submitCallback = useCallback((e: TargetedSubmitEvent<HTMLFormElement>) => {
        if (!passwordRef.current) return;
        e.preventDefault();

        const password = String(passwordRef.current.value);
        passwordRef.current.value = "";
        protected_session.setupProtectedSession(password);
    }, [ passwordRef ]);

    return (
        <form class="protected-session-password-form tn-centered-form" onSubmit={submitCallback}>
            <span class="form-icon bx bx-key" />
            
            <FormGroup name="protected-session-password-in-detail" label={t("protected_session.enter_password_instruction")}>
                <FormTextBox
                    type="password"
                    className="protected-session-password"
                    autocomplete="current-password"
                    inputRef={passwordRef}
                />
            </FormGroup>

            <Button
                text={t("protected_session.start_session_button")}
                kind="primary"
                keyboardShortcut="Enter"
            />
        </form>
    );
}
