import "./password.css";

import { ChangePasswordResponse, OAuthStatus, TOTPStatus } from "@triliumnext/commons";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useState } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import { oauthAccountLabel, oauthProviderDisplayName } from "../../../services/oauth_status";
import protected_session_holder from "../../../services/protected_session_holder";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import { ExtendedAdmonition } from "../../react/Admonition";
import Button from "../../react/Button";
import FormGroup from "../../react/FormGroup";
import FormSelect from "../../react/FormSelect";
import FormText from "../../react/FormText";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption } from "../../react/hooks";
import Modal from "../../react/Modal";
import RawHtml from "../../react/RawHtml";
import MfaStatusBadge, { MfaStatusTone } from "./components/MfaStatusBadge";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsBlock from "./components/OptionsBlock";
import OptionsRow, { OptionsRowWithButton } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import TimeSelector from "./components/TimeSelector";
import { TotpSettings } from "./totp";

export default function PasswordSettings() {
    return (
        <>
            <OptionsPageHeader />
            {/* The sign-in method (and its two-factor / OAuth settings) is only available on the server
                build — the desktop app authenticates differently — matching the former MFA page's
                serverOnly scope. */}
            {!isElectron() && <SignInMethod />}
            <ChangePassword />
            <ProtectedSessionTimeout />
        </>
    );
}

function ChangePassword() {
    const [showModal, setShowModal] = useState(false);

    return (
        <OptionsSection title={t("password.heading")}>
            <OptionsRowWithButton
                label={t("password.change_password")}
                description={t("password.change_password_description")}
                buttonText={t("password.change_password_button")}
                onClick={() => setShowModal(true)}
            />

            <OptionsRowWithButton
                label={t("password.reset_password")}
                description={t("password.reset_password_description")}
                buttonText={t("password.reset_password_button")}
                onClick={async () => {
                    if (!await dialog.confirm(t("password.reset_confirmation"))) {
                        return;
                    }

                    await server.post("password/reset?really=yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes");
                    toast.showError(t("password.reset_success_message"));
                }}
            />

            {createPortal(
                <ChangePasswordModal show={showModal} onHidden={() => setShowModal(false)} />,
                document.body
            )}
        </OptionsSection>
    );
}

interface ChangePasswordModalProps {
    show: boolean;
    onHidden: () => void;
}

function ChangePasswordModal({ show, onHidden }: ChangePasswordModalProps) {
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword1, setNewPassword1] = useState("");
    const [newPassword2, setNewPassword2] = useState("");

    const handleSubmit = async () => {
        if (newPassword1 !== newPassword2) {
            toast.showError(t("password.password_mismatch"));
            return;
        }

        const result = await server.post<ChangePasswordResponse>("password/change", {
            current_password: oldPassword,
            new_password: newPassword1
        });

        if (result.success) {
            onHidden();
            setOldPassword("");
            setNewPassword1("");
            setNewPassword2("");
            toast.showMessage(t("password.password_changed_success"));

            // password changed so current protected session is invalid and needs to be cleared
            protected_session_holder.resetProtectedSession();
        } else if (result.message) {
            toast.showError(result.message);
        }
    };

    const handleHidden = () => {
        setOldPassword("");
        setNewPassword1("");
        setNewPassword2("");
        onHidden();
    };

    return (
        <Modal
            show={show}
            onHidden={handleHidden}
            onSubmit={handleSubmit}
            title={t("password.change_password_heading")}
            className="change-password-modal"
            size="md"
            stackable
            footer={
                <>
                    <Button text={t("password.cancel")} onClick={handleHidden} />
                    <Button text={t("password.change_password")} kind="primary" />
                </>
            }
        >
            <FormGroup name="old-password" label={t("password.old_password")}>
                <FormTextBox
                    type="password"
                    currentValue={oldPassword}
                    onChange={setOldPassword}
                />
            </FormGroup>

            <FormGroup name="new-password1" label={t("password.new_password")}>
                <FormTextBox
                    type="password"
                    currentValue={newPassword1}
                    onChange={setNewPassword1}
                />
            </FormGroup>

            <FormGroup name="new-password2" label={t("password.new_password_confirmation")}>
                <FormTextBox
                    type="password"
                    currentValue={newPassword2}
                    onChange={setNewPassword2}
                />
            </FormGroup>
        </Modal>
    );
}

function ProtectedSessionTimeout() {
    return (
        <OptionsSection title={t("password.protected_session_timeout")}>
            <OptionsRow
                name="protected-session-timeout"
                label={t("password.protected_session_timeout_label")}
                description={<>{t("password.protected_session_timeout_description")} <a class="tn-link" href="https://triliumnext.github.io/Docs/Wiki/protected-notes.html">{t("password.wiki")}</a> {t("password.for_more_info")}</>}
            >
                <TimeSelector
                    name="protected-session-timeout"
                    optionValueId="protectedSessionTimeout"
                    optionTimeScaleId="protectedSessionTimeoutTimeScale"
                    minimumSeconds={60}
                />
            </OptionsRow>
        </OptionsSection>
    );
}

/**
 * Two-factor authentication settings. Owns the live TOTP/OAuth status (the method selector needs
 * `totpStatus.set` to know whether to offer switching methods) and delegates the heavier TOTP UI to
 * its own module; OAuth is small and read-only, so it lives here.
 */
function SignInMethod() {
    // `mfaMethod` is the persisted choice: "oauth" means sign in via an OAuth provider, anything else
    // ("totp") means the local password (with TOTP as optional second factor). The dropdown speaks in
    // the user-facing "local"/"oauth" terms and maps back to the option here.
    const [ mfaMethod, setMfaMethod ] = useTriliumOption("mfaMethod");
    const [ totpStatus, setTotpStatus ] = useState<TOTPStatus>();
    const [ oauthStatus, setOauthStatus ] = useState<OAuthStatus>();

    const refreshTotpStatus = useCallback(() => {
        server.get<TOTPStatus>("totp/status").then(setTotpStatus);
    }, []);

    const refreshOauthStatus = useCallback(() => {
        server.get<OAuthStatus>("oauth/status").then(setOauthStatus);
    }, []);

    useEffect(() => {
        refreshTotpStatus();
        refreshOauthStatus();
    }, [ refreshTotpStatus, refreshOauthStatus ]);

    const usingOAuth = mfaMethod === "oauth";

    return (
        <>
            <OptionsSection className="signin-method" title={t("multi_factor_authentication.authentication_title")}>
                <OptionsRow name="signin-method" label={t("multi_factor_authentication.signin_method")}>
                    <FormSelect
                        values={[
                            { value: "local", label: t("multi_factor_authentication.signin_local") },
                            { value: "oauth", label: t("multi_factor_authentication.signin_oauth") }
                        ]}
                        keyProperty="value" titleProperty="label"
                        currentValue={usingOAuth ? "oauth" : "local"}
                        onChange={(value) => setMfaMethod(value === "oauth" ? "oauth" : "totp")}
                    />
                </OptionsRow>

                <FormText>
                    { usingOAuth
                        ? <RawHtml html={t("multi_factor_authentication.oauth_description")} />
                        : t("multi_factor_authentication.signin_local_description") }
                </FormText>
            </OptionsSection>

            { usingOAuth
                ? <OAuthStatusCard status={oauthStatus} refreshStatus={refreshOauthStatus} />
                : <TotpSettings totpStatus={totpStatus} refreshTotpStatus={refreshTotpStatus} /> }
        </>
    );
}

/**
 * OAuth status card, shown when OAuth is the selected sign-in method. The provider credentials are
 * configured server-side (env vars / config.ini), but binding an account is an explicit in-app step —
 * mirroring TOTP's verify-before-enable. Three states:
 *  - **not configured** → show the config hint (the server vars are missing);
 *  - **configured, not enrolled** → offer "Connect account", which runs the provider round-trip and
 *    binds the returned identity. SSO only becomes the live login method once this completes;
 *  - **enrolled** → show the connected account and a "Disconnect" action.
 */
function OAuthStatusCard({ status, refreshStatus }: { status?: OAuthStatus, refreshStatus: () => void }) {
    // "Configured" is purely about the server-side variables being present (the server's `enabled` flag
    // additionally requires mfaMethod === 'oauth', which is implied here since this card only renders then).
    const configured = (status?.missingVars?.length ?? 1) === 0;
    const enrolled = status?.enrolled ?? false;

    // The status badge mirrors the card's three states: an account is bound (green "Connected"),
    // the server is set up but no account is bound yet (amber "Not connected"), or the server-side
    // variables are missing entirely (muted "Not configured").
    const badge: { tone: MfaStatusTone, text: string } = enrolled
        ? { tone: "active", text: t("multi_factor_authentication.oauth_status_connected") }
        : configured
            ? { tone: "pending", text: t("multi_factor_authentication.oauth_status_not_connected") }
            : { tone: "inactive", text: t("multi_factor_authentication.oauth_status_not_configured") };

    // Enrollment is a full-page provider round-trip (not an XHR): navigate to the OIDC login route,
    // which on return binds the identity to this still-authenticated session (see open_id afterCallback).
    // The return lands on the app root and drops this modal; the resulting "connected" toast is driven by
    // a one-shot bootstrap flag (see showOAuthEnrollmentResultToast), so nothing is tracked here.
    const connectAccount = useCallback(() => {
        window.location.href = "authenticate";
    }, []);

    const disconnectAccount = useCallback(async () => {
        if (!await dialog.confirm(t("multi_factor_authentication.oauth_disconnect_confirm"))) {
            return;
        }

        // Resolve the labels before disconnecting, while the account is still bound.
        const account = oauthAccountLabel(status);
        const provider = oauthProviderDisplayName(status);

        await server.post("oauth/disconnect");
        toast.showMessage(t("multi_factor_authentication.oauth_disconnected", { account, provider }));
        refreshStatus();
    }, [ status, refreshStatus ]);

    return (
        <OptionsSection
            title={
                <span className="mfa-status-title">
                    {t("multi_factor_authentication.oauth_title")}
                    <MfaStatusBadge tone={badge.tone} text={badge.text} />
                </span>
            }
            noCard={!configured}
        >
            { !configured ? (
                <ExtendedAdmonition
                    type="note"
                    icon="bx bx-info-circle"
                    title={t("multi_factor_authentication.oauth_not_configured_title")}
                    detailsLabel={t("multi_factor_authentication.oauth_how_to_enable")}
                    details={<OAuthConfigInstructions />}
                >
                    <p>{t("multi_factor_authentication.oauth_not_configured_hint")}</p>

                    { status?.missingVars && status.missingVars.length > 0 && (
                        <p>
                            {t("multi_factor_authentication.oauth_missing_vars", {
                                variables: status.missingVars.map(v => `"${v}"`).join(", ")
                            })}
                        </p>
                    )}
                </ExtendedAdmonition>
            ) : enrolled ? (
                <>
                    <OAuthProviderRows status={status} />
                    <OptionsRow name="oauth-user-account" label={t("multi_factor_authentication.oauth_user_account")}>
                        <span>{status?.name ?? t("multi_factor_authentication.oauth_user_not_logged_in")}</span>
                    </OptionsRow>
                    <OptionsRow name="oauth-user-email" label={t("multi_factor_authentication.oauth_user_email")}>
                        <span>{status?.email ?? t("multi_factor_authentication.oauth_user_not_logged_in")}</span>
                    </OptionsRow>

                    <OptionsRowWithButton
                        label={t("multi_factor_authentication.oauth_disconnect_label")}
                        description={t("multi_factor_authentication.oauth_disconnect_description")}
                        icon="bx-trash"
                        buttonClassName="oauth-disconnect-button"
                        buttonText={t("multi_factor_authentication.oauth_disconnect_button")}
                        onClick={() => void disconnectAccount()}
                    />
                </>
            ) : (
                <>
                    <OptionsBlock noPadding>
                        <ExtendedAdmonition
                            type="note"
                            icon="bx bx-info-circle"
                            title={t("multi_factor_authentication.oauth_not_enrolled_title")}
                            detailsLabel={t("multi_factor_authentication.oauth_not_enrolled_details_label")}
                            details={t("multi_factor_authentication.oauth_not_enrolled_details")}
                        >
                            {t("multi_factor_authentication.oauth_not_enrolled_hint")}
                        </ExtendedAdmonition>
                    </OptionsBlock>

                    <OAuthProviderRows status={status} />

                    <OptionsRowWithButton
                        label={t("multi_factor_authentication.oauth_connect_label")}
                        description={t("multi_factor_authentication.oauth_connect_description")}
                        icon="bx-log-in"
                        buttonText={t("multi_factor_authentication.oauth_connect_button")}
                        onClick={connectAccount}
                    />
                </>
            )}
        </OptionsSection>
    );
}

/**
 * Identifies the configured OAuth provider: its icon and display name, plus the issuer URL. Shown
 * whenever OAuth is configured so the owner can confirm which server they'll be redirected to.
 */
function OAuthProviderRows({ status }: { status?: OAuthStatus }) {
    const displayName = oauthProviderDisplayName(status);
    return (
        <>
            <OptionsRow name="oauth-provider" label={t("multi_factor_authentication.oauth_provider")}>
                <span className="oauth-provider">
                    <OAuthProviderIcon src={status?.issuerIcon} />
                    <span>{displayName}</span>
                </span>
            </OptionsRow>
            { status?.issuerUrl && (
                <OptionsRow name="oauth-provider-url" label={t("multi_factor_authentication.oauth_provider_url")}>
                    <span>{status.issuerUrl}</span>
                </OptionsRow>
            )}
        </>
    );
}

/**
 * Provider icon for the OAuth status card. Renders the configured/derived issuer icon, falling back
 * to a neutral key glyph when no icon is available or the image fails to load (e.g. a derived
 * favicon URL that the issuer doesn't actually serve).
 */
function OAuthProviderIcon({ src }: { src?: string }) {
    const [ failed, setFailed ] = useState(false);

    // Reset the fallback flag when the source changes (e.g. the user switches providers), otherwise a
    // previously-failed load would keep showing the key glyph even when the new URL is perfectly valid.
    useEffect(() => setFailed(false), [src]);

    if (!src || failed) {
        return <span className="bx bx-key oauth-provider-icon" />;
    }

    return <img className="oauth-provider-icon" src={src} alt="" onError={() => setFailed(true)} />;
}

/**
 * "How to enable" instructions for OAuth, shown in the not-configured admonition's collapsible. Lists
 * the config.ini section and the equivalent environment variables the server reads — OAuth has no
 * in-app setup, so this is the only place the values are documented in the UI.
 */
function OAuthConfigInstructions() {
    // oauthBaseUrl is the app's externally-reachable base URL, which for the user reading this is
    // exactly the origin they're browsing from — so prefill it as a sensible example value.
    const baseUrl = window.location.origin;
    return (
        <>
            <p>{t("multi_factor_authentication.oauth_server_config_hint")}</p>
            <pre><code>{`[MultiFactorAuthentication]\noauthBaseUrl=${baseUrl}\noauthClientId=\noauthClientSecret=`}</code></pre>
            <p>{t("multi_factor_authentication.oauth_server_env_hint")}</p>
            <pre><code>{`TRILIUM_OAUTH_BASE_URL=${baseUrl}\nTRILIUM_OAUTH_CLIENT_ID=\nTRILIUM_OAUTH_CLIENT_SECRET=`}</code></pre>
        </>
    );
}
