import "./setup.css";
import "./set_password.css";

import type { LOCALE_IDS, SetupAccountInfo } from "@triliumnext/commons";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { initLocale, t } from "./services/i18n";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import FormTextBox from "./widgets/react/FormTextBox";
import Icon from "./widgets/react/Icon";
import SetupPage from "./widgets/react/SetupPage";
import OptionsRow from "./widgets/type_widgets/options/components/OptionsRow";

/** Same floor as the server's `MIN_PASSWORD_LENGTH` in `routes/api/setup_account.ts`. */
const MIN_PASSWORD_LENGTH = 4;

/** Where the screen is: checking the link, the link was refused, choosing a password, or done. */
type SetupState =
    | { kind: "checking" }
    | { kind: "invalid" }
    | { kind: "form"; info: SetupAccountInfo }
    | { kind: "done"; username: string };

async function main() {
    await initLocale((window.glob.currentLocale?.id ?? "en") as LOCALE_IDS, "entry");

    const bodyWrapper = document.createElement("div");
    bodyWrapper.classList.add("setup-outer-wrapper");
    document.body.classList.add("setup");
    render(<App token={getSetupToken(window.location.search)} />, bodyWrapper);
    document.body.replaceChildren(bodyWrapper);
}

export function App({ token }: { token: string }) {
    const [ state, setState ] = useState<SetupState>({ kind: "checking" });

    useEffect(() => {
        checkSetupLink(token).then((info) => setState(info ? { kind: "form", info } : { kind: "invalid" }));
    }, [ token ]);

    return (
        <div class="setup-container set-password-container setup-account-container">
            {state.kind === "checking" && <SetupPage className="set-password" title={t("setup_account.checking")} />}
            {state.kind === "invalid" && (
                <SetupPage
                    className="set-password"
                    title={t("setup_account.invalid-heading")}
                    description={t("setup_account.invalid-description")}
                    illustration={<Icon icon="bx bx-unlink" className="illustration-icon" />}
                />
            )}
            {state.kind === "form" && (
                <PasswordForm
                    token={token}
                    info={state.info}
                    onDone={() => setState({ kind: "done", username: state.info.username })}
                    onInvalid={() => setState({ kind: "invalid" })}
                />
            )}
            {state.kind === "done" && (
                <SetupPage
                    className="set-password"
                    title={t("setup_account.done-heading")}
                    description={t("setup_account.done-description", { username: state.username })}
                    illustration={<Icon icon="bx bx-check-circle" className="illustration-icon" />}
                    footer={(
                        // Back to the root without the spent link; the `login` marker gets past a
                        // bare-domain redirect to the share page.
                        <Button
                            text={t("setup_account.go-to-login")}
                            kind="primary"
                            onClick={() => window.location.assign("./?login")}
                        />
                    )}
                />
            )}
        </div>
    );
}

interface PasswordFormProps {
    token: string;
    info: SetupAccountInfo;
    onDone(): void;
    onInvalid(): void;
}

function PasswordForm({ token, info, onDone, onInvalid }: PasswordFormProps) {
    const [ password1, setPassword1 ] = useState("");
    const [ password2, setPassword2 ] = useState("");
    const [ submitting, setSubmitting ] = useState(false);
    const [ error, setError ] = useState<string>();
    const [ errorId, setErrorId ] = useState(0);

    // Mirror the server-side validation so the form can't be submitted into an error.
    const tooShort = password1 !== "" && password1.length < MIN_PASSWORD_LENGTH;
    const mismatch = password2 !== "" && password1 !== password2;
    const isValid = password1.length >= MIN_PASSWORD_LENGTH && password1 === password2;

    async function submit(e: Event) {
        e.preventDefault();
        if (!isValid || submitting) return;

        setSubmitting(true);
        const outcome = await completeSetup(token, password1, password2);
        setSubmitting(false);

        if (outcome === "done") {
            onDone();
        } else if (outcome === "invalid") {
            onInvalid();
        } else {
            setError(t(outcome === "rate-limited" ? "setup_account.too-many-attempts" : "setup_account.connection-error"));
            setErrorId((id) => id + 1);
        }
    }

    return (
        <form onSubmit={submit}>
            <SetupPage
                className="set-password"
                title={t("setup_account.heading", { username: info.username })}
                description={t("setup_account.description", { date: formatExpiry(info.expiresAt) })}
                illustration={<Icon icon="bx bx-user-check" className="illustration-icon" />}
                error={error}
                errorId={errorId}
                footer={<Button text={t("setup_account.button")} kind="primary" disabled={!isValid || submitting} />}
            >
                <Card>
                    <CardSection>
                        <OptionsRow name="username" label={t("setup_account.username")} stacked>
                            {/* Shown, and offered to the password manager alongside the new password. */}
                            <FormTextBox currentValue={info.username} autocomplete="username" readOnly />
                        </OptionsRow>

                        <OptionsRow
                            name="password1" label={t("setup_account.password")}
                            description={tooShort ? <span className="text-danger">{t("setup_account.password-too-short", { length: MIN_PASSWORD_LENGTH })}</span> : undefined}
                            stacked
                        >
                            <FormTextBox
                                className={tooShort ? "is-invalid" : undefined}
                                autoFocus type="password"
                                currentValue={password1} onChange={setPassword1}
                                autocomplete="new-password" required
                            />
                        </OptionsRow>

                        <OptionsRow
                            name="password2" label={t("setup_account.password-confirmation")}
                            description={mismatch ? <span className="text-danger">{t("setup_account.passwords-dont-match")}</span> : undefined}
                            stacked
                        >
                            <FormTextBox
                                className={mismatch ? "is-invalid" : undefined}
                                type="password"
                                currentValue={password2} onChange={setPassword2}
                                autocomplete="new-password" required
                            />
                        </OptionsRow>
                    </CardSection>
                </Card>
            </SetupPage>
        </form>
    );
}

/** The token a setup link carries, as `?setupAccount=<token>` on the instance's root URL. */
export function getSetupToken(search: string) {
    return new URLSearchParams(search).get("setupAccount") ?? "";
}

/** The account a setup link was issued for, or `null` when the server refuses the link. */
export async function checkSetupLink(token: string): Promise<SetupAccountInfo | null> {
    if (!token) return null;

    try {
        const resp = await fetch("api/setup-account/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        return resp.ok ? await resp.json() as SetupAccountInfo : null;
    } catch {
        return null;
    }
}

export async function completeSetup(token: string, password1: string, password2: string) {
    try {
        const resp = await fetch("api/setup-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, password1, password2 })
        });

        if (resp.ok) return "done";
        if (resp.status === 429) return "rate-limited";
        return "invalid";
    } catch {
        return "connection-error";
    }
}

function formatExpiry(expiresAt: string) {
    const date = new Date(expiresAt.replace(" ", "T"));
    return new Intl.DateTimeFormat(window.glob.currentLocale?.id, { dateStyle: "long", timeStyle: "short" }).format(date);
}

// index.ts holds the splash up until the page has rendered. The render under test imports
// the component directly, so it skips this one.
export const ready = import.meta.env.MODE !== "test" ? main() : Promise.resolve();
