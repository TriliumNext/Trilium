import { useCallback, useRef } from "preact/hooks";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup";
import FormTextBox from "../react/FormTextBox";
import "./ProtectedSession.css";
import protected_session from "../../services/protected_session";
import type { TargetedSubmitEvent } from "preact";

export default function ProtectedSession() {
    const passwordRef = useRef<HTMLInputElement>(null);

    const submitCallback = useCallback((e: TargetedSubmitEvent<HTMLFormElement>) => {
        if (!passwordRef.current) return;
        e.preventDefault();

        const password = String(passwordRef.current.value);
        passwordRef.current.value = "";
        protected_session.setupProtectedSession(password);
    }, [ passwordRef ]);

    return (
        <form class="protected-session-password-form" onSubmit={submitCallback}>
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
                primary
                keyboardShortcut="Enter"
            />
        </form>
    )
}
