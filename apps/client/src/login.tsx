import "./setup.css";
import "./login.css";

import { LOCALE_IDS } from "@triliumnext/commons";
import { render } from "preact";

import logo from "./assets/icon-color.svg?url";
import { initLocale, t } from "./services/i18n";
import Button from "./widgets/react/Button";
import CredentialsForm, { type Credentials } from "./widgets/react/CredentialsForm";
import SetupPage from "./widgets/react/SetupPage";

async function main() {
    await initLocale((window.glob.currentLocale?.id ?? "en") as LOCALE_IDS, "entry");

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
    // Nothing on this page can raise a second one: the SSO branch navigates away rather than
    // submitting, and the password form below reports its own.
    const error = initialSsoError(config);

    if (config?.ssoEnabled) {
        return (
            <div class="setup-container login-container oidc">
                <SetupPage className="login" title={t("login.heading")} illustration={illustration} error={error} errorId={0}>
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
                initialError={error}
            />
        </div>
    );
}

export function PasswordLogin({ illustration, totpEnabled, initialError }: {
    illustration: preact.ComponentChildren;
    totpEnabled: boolean;
    initialError: string | null;
}) {
    async function submit({ password, totpToken, rememberMe }: Credentials) {
        try {
            const body = new URLSearchParams({ password });
            if (totpEnabled) {
                body.set("totpToken", totpToken);
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
                return null;
            }

            if (resp.status === 429) {
                // Rate limiter kicked in (too many attempts) — not a credential failure.
                return t("login.too-many-attempts");
            }

            const factor = resp.status === 401 ? (await resp.json().catch(() => ({}))).factor : undefined;
            if (factor === "totp") {
                // This field accepts either a 6-digit TOTP or a recovery code (22 chars + "=="),
                // so tailor the message to what was actually entered. This keys off the user's
                // own input shape, never server state, so it can't reveal whether a given code
                // was genuinely valid or already used.
                return t(looksLikeRecoveryCode(totpToken) ? "login.incorrect-recovery-code" : "login.incorrect-totp");
            }

            return t("login.incorrect-password");
        } catch {
            // fetch only rejects on network-level failures (server unreachable, DNS, etc.) —
            // not on HTTP error statuses — so this is a connection problem, not bad credentials.
            return t("login.connection-error");
        }
    }

    return (
        <CredentialsForm
            className="login"
            title={t("login.heading")}
            illustration={illustration}
            totpEnabled={totpEnabled}
            rememberMeEnabled
            submitLabel={t("login.button")}
            initialError={initialError}
            onSubmit={submit}
        />
    );
}

/** Whether what was typed into the second-factor field is shaped like a recovery code. */
export function looksLikeRecoveryCode(answer: string): boolean {
    return /^.{22}==$/.test(answer);
}

function initialSsoError(config: typeof window.glob.login): string | null {
    // `ssoError` is the outcome of a round-trip that actually reached the provider, so it is the more
    // specific message and wins over the generic connection failure.
    if (config?.ssoError) {
        return config.ssoError === "wrong_account" ? t("login.sso-wrong-account") : t("login.sso-not-enrolled");
    }
    if (config?.ssoConnectionFailed) {
        return t("login.sso-connection-failed");
    }
    return null;
}

// index.ts holds the splash up until the page has rendered. The render under test imports
// the components directly, so it skips this one.
export const ready = import.meta.env.MODE !== "test" ? main() : Promise.resolve();
