import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Button from "./Button";
import { Card, CardSection } from "./Card";
import FormTextBox from "./FormTextBox";
import SetupPage from "./SetupPage";
import OptionsRow, { OptionsRowWithToggle } from "../type_widgets/options/components/OptionsRow";

/** What the user answered, for the caller to do whatever it does with. */
export interface Credentials {
    password: string;
    /** Empty where no second factor was asked for. */
    totpToken: string;
    /** Always `false` where the form does not offer it. */
    rememberMe: boolean;
}

/**
 * Asking for the instance's own credentials, as a whole page.
 *
 * Two screens ask: the login screen, and the setup wizard standing over a knowledge base it has to
 * prove ownership of before it will touch it. To a user those are the same question, so they are the
 * same form — the same fields, in the same order, reporting failures the same way. What differs is
 * only what happens with the answer, which is what {@link CredentialsFormProps.onSubmit} is for.
 *
 * The fields are uncontrolled and read from their refs at submit time. A controlled value of `""`
 * overwrites what the browser autofilled, so the first press would submit an empty password: the
 * "incorrect password, press again" bug. Neither screen needs live validation. `rememberMe` is a
 * toggle the user actually clicks, so that one is controlled.
 *
 * @module
 */
export interface CredentialsFormProps {
    title: string;
    illustration?: ComponentChildren;
    /** Asks for a second factor beside the password. */
    totpEnabled?: boolean;
    /** Offers to be remembered past this session. Login only; the wizard holds nothing that long. */
    rememberMeEnabled?: boolean;
    submitLabel: string;
    className?: string;
    /** On the form itself, for the page layout each caller's own stylesheet gives it. */
    formClassName?: string;
    /**
     * Something that went wrong before the form was ever shown, such as an SSO round-trip that came
     * back refused. Anything the form itself provokes it reports on its own.
     */
    initialError?: string | null;
    /**
     * What to do with the answer.
     *
     * @returns the message to show, or `null` where it worked — in which case the caller has already
     *          done whatever comes next, and this form is on its way off the screen.
     */
    onSubmit: (credentials: Credentials) => Promise<string | null>;
}

export default function CredentialsForm({
    title, illustration, totpEnabled, rememberMeEnabled, submitLabel, className, formClassName,
    initialError, onSubmit
}: CredentialsFormProps) {
    const passwordRef = useRef<HTMLInputElement>(null);
    const totpRef = useRef<HTMLInputElement>(null);
    const [ rememberMe, setRememberMe ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);
    // Carries its own id so that answering wrongly twice over shows the message again rather than
    // leaving it dismissed, which is what `SetupPage` keys the banner on.
    const [ failure, setFailure ] = useState<{ message: string; id: number } | null>(null);

    async function handleSubmit(e: Event) {
        e.preventDefault();
        // The button is disabled while it runs, but Enter in a field is a second way in.
        if (submitting) {
            return;
        }

        setSubmitting(true);
        try {
            const message = await onSubmit({
                password: passwordRef.current?.value ?? "",
                totpToken: totpEnabled ? totpRef.current?.value ?? "" : "",
                rememberMe
            });

            if (message !== null) {
                setFailure((previous) => ({ message, id: (previous?.id ?? 0) + 1 }));
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form className={formClassName} onSubmit={(e) => void handleSubmit(e)}>
            <SetupPage
                className={className}
                title={title}
                illustration={illustration}
                // What the last press was answered with, or, until there has been one, whatever the
                // caller already had to report.
                error={failure?.message ?? initialError ?? null}
                errorId={failure?.id ?? 0}
                footer={<Button text={submitLabel} kind="primary" disabled={submitting} />}
            >
                <Card>
                    <CardSection>
                        <OptionsRow name="password" label={t("login.password")} stacked>
                            <FormTextBox
                                inputRef={passwordRef} autoFocus
                                type="password" name="password"
                                autocomplete="current-password" required
                            />
                        </OptionsRow>

                        {totpEnabled && (
                            <OptionsRow name="totpToken" label={t("login.totp-token")} stacked>
                                <FormTextBox
                                    inputRef={totpRef}
                                    name="totpToken"
                                    autocomplete="one-time-code" required
                                />
                            </OptionsRow>
                        )}

                        {rememberMeEnabled && (
                            <OptionsRowWithToggle
                                name="rememberMe"
                                label={t("login.remember-me")}
                                currentValue={rememberMe}
                                onChange={setRememberMe}
                            />
                        )}
                    </CardSection>
                </Card>
            </SetupPage>
        </form>
    );
}
