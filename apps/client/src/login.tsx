import "./setup.css";
import "./login.css";

import { LOCALE_IDS } from "@triliumnext/commons";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";

import logo from "./assets/icon-color.svg?url";
import { initLocale, t } from "./services/i18n";
import Button from "./widgets/react/Button";
import { Card, CardSection } from "./widgets/react/Card";
import FormTextBox from "./widgets/react/FormTextBox";
import SetupPage from "./widgets/react/SetupPage";
import OptionsRow, { OptionsRowWithToggle } from "./widgets/type_widgets/options/components/OptionsRow";

async function main() {
    await initLocale((window.glob.currentLocale?.id ?? "en") as LOCALE_IDS);

    const bodyWrapper = document.createElement("div");
    bodyWrapper.classList.add("setup-outer-wrapper");
    // The device/theme body classes are already applied by index.ts (this page is
    // loaded through the regular bootstrap); we only add the setup styling hook.
    document.body.classList.add("setup");
    render(<App />, bodyWrapper);
    document.body.replaceChildren(bodyWrapper);
}

export function App() {
    const config = window.glob.login;
    const illustration = <img src={logo} alt="" className="illustration-logo" />;

    const [ error, setError ] = useState<string | null>(ssoErrorMessage(config?.ssoError));
    const [ errorId, setErrorId ] = useState(0);

    function raiseError(message: string) {
        setError(message);
        setErrorId((id) => id + 1);
    }

    if (config?.ssoEnabled) {
        return (
            <div class="setup-container login-container oidc">
                <SetupPage className="login" title={t("login.heading")} illustration={illustration} error={error} errorId={errorId}>
                    {/* A <button>, not an <a>, on purpose: link.ts installs a global anchor-click
                        handler that preventDefaults every link and only navigates note/http links,
                        so an <a> to a plain server route gets swallowed. A button sidesteps it and
                        just navigates to the route that starts the OpenID round-trip. */}
                    <Button
                        className="oidc-login"
                        onClick={() => { window.location.href = "/authenticate"; }}
                        text={(
                            <>
                                {config.ssoIssuerIcon
                                    ? <img src={config.ssoIssuerIcon} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                    : null}
                                {t("login.sign_in_with_sso", { ssoIssuerName: config.ssoIssuerName ?? "" })}
                            </>
                        )}
                    />
                </SetupPage>
            </div>
        );
    }

    return (
        <div class="setup-container login-container">
            <PasswordLogin
                illustration={illustration}
                totpEnabled={config?.totpEnabled ?? false}
                error={error}
                errorId={errorId}
                onError={raiseError}
            />
        </div>
    );
}

export function PasswordLogin({ illustration, totpEnabled, error, errorId, onError }: {
    illustration: preact.ComponentChildren;
    totpEnabled: boolean;
    error: string | null;
    errorId: number;
    onError: (message: string) => void;
}) {
    // Read the password / TOTP straight from the DOM at submit time instead of mirroring
    // them into controlled state. A controlled value of "" overwrites (and loses) browser-
    // autofilled credentials, so the first click would submit an empty password — the
    // "incorrect password, press again" bug. These fields need no live validation, so they
    // stay uncontrolled. (rememberMe is a toggle the user actually clicks, so it's controlled.)
    const passwordRef = useRef<HTMLInputElement>(null);
    const totpRef = useRef<HTMLInputElement>(null);
    const [ rememberMe, setRememberMe ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);

    async function handleSubmit(e: Event) {
        e.preventDefault();
        if (submitting) {
            return;
        }
        setSubmitting(true);
        try {
            const body = new URLSearchParams({ password: passwordRef.current?.value ?? "" });
            if (totpEnabled) {
                body.set("totpToken", totpRef.current?.value ?? "");
            }
            if (rememberMe) {
                body.set("rememberMe", "1");
            }

            const resp = await fetch("login", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body
            });

            if (resp.ok) {
                // Session established — navigate to the app.
                window.location.assign(".");
                return;
            }

            if (resp.status === 429) {
                // Rate limiter kicked in (too many attempts) — not a credential failure.
                onError(t("login.too-many-attempts"));
                return;
            }

            const factor = resp.status === 401 ? (await resp.json().catch(() => ({}))).factor : undefined;
            if (factor === "totp") {
                // This field accepts either a 6-digit TOTP or a recovery code (22 chars + "=="),
                // so tailor the message to what was actually entered. This keys off the user's
                // own input shape, never server state, so it can't reveal whether a given code
                // was genuinely valid or already used.
                const looksLikeRecoveryCode = /^.{22}==$/.test(totpRef.current?.value ?? "");
                onError(t(looksLikeRecoveryCode ? "login.incorrect-recovery-code" : "login.incorrect-totp"));
            } else {
                onError(t("login.incorrect-password"));
            }
        } catch {
            // fetch only rejects on network-level failures (server unreachable, DNS, etc.) —
            // not on HTTP error statuses — so this is a connection problem, not bad credentials.
            onError(t("login.connection-error"));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={(e) => void handleSubmit(e)}>
            <SetupPage
                className="login"
                title={t("login.heading")}
                illustration={illustration}
                error={error}
                errorId={errorId}
                footer={<Button text={t("login.button")} kind="primary" disabled={submitting} />}
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

                        <OptionsRowWithToggle
                            name="rememberMe"
                            label={t("login.remember-me")}
                            currentValue={rememberMe}
                            onChange={setRememberMe}
                        />
                    </CardSection>
                </Card>
            </SetupPage>
        </form>
    );
}

function ssoErrorMessage(ssoError: string | false | undefined): string | null {
    if (!ssoError) {
        return null;
    }
    return ssoError === "wrong_account" ? t("login.sso-wrong-account") : t("login.sso-not-enrolled");
}

// Skip the bootstrap render under test, where the components are imported directly.
if (import.meta.env.MODE !== "test") {
    void main();
}
